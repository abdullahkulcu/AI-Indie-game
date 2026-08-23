import { factionDrag } from "./faction";
import type { Game } from "./types";

/**
 * Halk sistemi: istihkak → mutluluk → üretim ve nüfus.
 *
 * Saf fonksiyonlardır; tick ve emirler bunları kullanır. Mutluluk birikimli
 * değil HEDEFE YAKINSAYAN bir modeldir: mevcut koşullar bir hedef rıza üretir,
 * gerçek rıza saatte birkaç puan o hedefe doğru yürür. Böylece Kral bir ayarı
 * değiştirdiğinde sonucu öngörebilir ve General de gerekçesini açıklayabilir.
 */

/** Kişi başı saatlik temel ihtiyaç. %100 istihkak bu demektir. */
export const NEED = {
  food: 0.035,
  ale: 0.012,
  /** Asker başına saatlik temel maaş. */
  soldierGold: 0.35,
} as const;

export const RATION_LIMITS = { min: 0, max: 200 } as const;

/**
 * TAM PAY (%). Halk bu oranda doyar; altı ceza, üstü ölçülü ödül.
 *
 * Sayı zaten `moodParts` içinde eşik olarak duruyordu; sabit olarak dışa
 * verilmesinin sebebi ikinci ve üçüncü okuyucusunun çıkması:
 * `engine/populace-voice.ts` → `VOICE_THRESHOLDS.vaat.promise` (Kral tam pay
 * İLAN ETTİ mi) ve aşağıdaki `deliberateExodus` (Kral tam payı bilerek mi
 * kıstı). Üç yerde elle yazılsaydı "tam pay" kavramı sessizce sapardı.
 */
export const FULL_RATION = 100;

/**
 * Vergi oranının NÖTR noktası (%). Bunun altı rızayı yükseltir, üstü aşındırır.
 * `moodParts` içinde eşik olarak zaten vardı; `deliberateExodus` de aynı
 * noktayı okuduğu için dışa verildi.
 */
export const TAX_NEUTRAL = 15;

/** Rızanın hedefe yaklaşma hızı (puan/saat). */
const MOOD_APPROACH = 5;

/** Akının hemen ardından hedef rızadan düşülen puan ve sönümlenme sabiti (saat). */
const RAID_TRAUMA = 14;
const RAID_TRAUMA_HALFLIFE = 8;

export type Rations = { food: number; ale: number; soldierPay: number };

export function rationsOf(game: Partial<Game>): Rations {
  return {
    food: clampRation(game.foodRation ?? 100),
    ale: clampRation(game.aleRation ?? 0),
    soldierPay: clampRation(game.soldierPay ?? 100),
  };
}

export const clampRation = (value: number) =>
  Math.max(RATION_LIMITS.min, Math.min(RATION_LIMITS.max, Math.round(Number(value) || 0)));

export const armySize = (units: Record<string, number>) =>
  Object.values(units).reduce((total, amount) => total + Math.max(0, amount), 0);

/** Bir saatlik talep. Karşılanıp karşılanmadığı ayrı hesaplanır. */
export function hourlyDemand(game: Pick<Game, "population" | "units" | "foodRation" | "aleRation" | "soldierPay">) {
  const rations = rationsOf(game);
  const army = armySize(game.units ?? {});
  return {
    food: game.population * NEED.food * (rations.food / 100),
    ale: game.population * NEED.ale * (rations.ale / 100),
    gold: army * NEED.soldierGold * (rations.soldierPay / 100),
  };
}

/** 0 = hiç karşılanmadı, 1 = tam karşılandı. Stok yoksa istihkak kâğıt üstünde kalır. */
export function satisfaction(demand: number, available: number) {
  if (demand <= 0) return 1;
  return Math.max(0, Math.min(1, available / demand));
}

export type MoodInputs = {
  /** Fiilen dağıtılabilen yiyecek istihkakı (%). */
  servedFood: number;
  servedAle: number;
  taxRate: number;
  population: number;
  capacity: number;
  buildings: Array<{ type: string; level: number }>;
  /** Son akından bu yana geçen saat. Akın halkı bir süre sarsılmış bırakır. */
  hoursSinceRaid?: number | null;
  /**
   * Yerel pazardaki geçim maliyetinin rızaya yansıması (puan). Artı = ucuz
   * ekmek, eksi = pahalı ekmek. Hesabı `engine/market.ts` yapar
   * (`livingCostMood`); burada hazır puan olarak alınır, çünkü kuralın kendisi
   * pazarın kuralıdır ve iki modülün birbirini içe aktarması gerekmesin.
   *
   * Eski kayıtlarda ve pazarı olmayan çağrılarda 0'dır: halkın defteri
   * bilinmiyorsa fiyat normal sayılır ve rıza bu kalemden etkilenmez.
   */
  livingMood?: number;
};

/** Eğlence ve idare yapılarının rızaya katkısı. */
const AMENITY_VALUE: Record<string, number> = {
  park: 4,
  marriage_hall: 3,
  theater: 7,
  town_square: 2,
};

/**
 * Hedef rızayı oluşturan kalemler, TEK TEK.
 *
 * `moodTarget` bu kalemleri aynı sırayla toplar; ayrıca göç bildirimi hangi
 * kalemin en ağır bastığını buradan okur (bkz. `heaviestGrievance`). Kalemler
 * ayrıştırılmadan önce "göçün sebebi" ikinci bir yerde yeniden hesaplanmak
 * zorundaydı ve iki hesap birbirinden sapardı.
 */
export type MoodParts = {
  food: number;
  ale: number;
  tax: number;
  living: number;
  amenities: number[];
  raid: number;
  crowding: number;
};

export function moodParts(input: MoodInputs): MoodParts {
  // Yiyecek: %100 nötr, altı hızla cezalandırılır, üstü ölçülü ödüllendirir.
  const food = input.servedFood;
  // Aç halk eğlenceye sevinmez: bira ve eğlence yapılarının katkısı tokluk
  // oranıyla ölçeklenir. Aksi hâlde tiyatro açlığı gizleyebiliyordu.
  const fed = Math.max(0, Math.min(1, food / 100));
  const amenities: number[] = [];
  for (const building of input.buildings) {
    const value = AMENITY_VALUE[building.type];
    if (value) amenities.push(value * Math.min(3, building.level) * fed);
  }
  // Kalabalıklık: kapasitenin %90'ını aşınca huzursuzluk başlar.
  const crowding = input.capacity > 0 ? input.population / input.capacity : 0;
  return {
    food: food >= FULL_RATION ? Math.min(12, (food - 100) * 0.12) : -Math.pow((100 - food) / 100, 1.35) * 55,
    ale: Math.min(16, input.servedAle * 0.1) * fed,
    // Vergi: nötr nokta `TAX_NEUTRAL` (%15).
    tax: -((input.taxRate - TAX_NEUTRAL) * 0.9),
    // Pazardaki geçim maliyeti. İstihkak halkın AĞZINA ne girdiğini söyler; bu
    // ise kendi cebinden aldığı ekmeğin kaça mal olduğunu. Kral ambarı açıp
    // fiyatı kırarsa rıza yükselir, halkın kilerini pazardan süpürürse düşer.
    // `fed` ile ölçeklenmez: aç halk ekmeğin fiyatını daha çok umursar, az değil.
    living: input.livingMood ?? 0,
    amenities,
    // Akın travması: tek seferlik bir rıza düşüşü hedefe yakınsama yüzünden bir
    // saatte siliniyordu, yani yağmalanmak hissedilmiyordu. Artık hedefin kendisi
    // bir süre baskılanır ve yaklaşık bir günde düzelir.
    raid: input.hoursSinceRaid === null || input.hoursSinceRaid === undefined
      ? 0
      : -(RAID_TRAUMA * Math.exp(-Math.max(0, input.hoursSinceRaid) / RAID_TRAUMA_HALFLIFE)),
    crowding: crowding > 0.9 ? -((crowding - 0.9) * 120) : 0,
  };
}

/**
 * Mevcut koşulların işaret ettiği rıza. Açlık baskındır: istihkak %60'ın
 * altına düştüğünde diğer bütün iyileştirmeler anlamını yitirir.
 *
 * Toplama sırası `moodParts` ile birebir aynıdır; kayan nokta toplamının sırası
 * değiştirilirse eski kayıtların rızası kıl payı kayar.
 */
export function moodTarget(input: MoodInputs) {
  const parts = moodParts(input);
  let target = 50;
  target += parts.food;
  target += parts.ale;
  target += parts.tax;
  target += parts.living;
  for (const value of parts.amenities) target += value;
  target += parts.raid;
  target += parts.crowding;
  return Math.max(0, Math.min(100, target));
}

/** Göç bildiriminde gerekçe olarak gösterilen kalemler ve halkın ağzındaki adı. */
export const GRIEVANCE_LABELS = {
  food: "ambarın yarım payını",
  living: "pazarda pahalanan ekmeği",
  tax: "verginin ağırlığını",
  crowding: "konutların kalabalığını",
  raid: "akının yıkımını",
} as const;

export type GrievanceKey = keyof typeof GRIEVANCE_LABELS;

/**
 * Göçün EN AĞIR sebebi. Yeni bir hesap değil: `moodParts`'ın zaten ürettiği
 * eksi kalemlerin en büyüğü seçilir. Hiçbir kalem eksi değilse (halk başka bir
 * nedenle, örneğin salt kapasite tavanıyla eriyorsa) null döner ve bildirim
 * gerekçe uydurmaz.
 */
export function heaviestGrievance(input: MoodInputs): { key: GrievanceKey; label: string; weight: number } | null {
  const parts = moodParts(input);
  const keys = Object.keys(GRIEVANCE_LABELS) as GrievanceKey[];
  let worst: GrievanceKey | null = null;
  for (const key of keys) {
    if (parts[key] >= 0) continue;
    if (worst === null || parts[key] < parts[worst]) worst = key;
  }
  return worst === null ? null : { key: worst, label: GRIEVANCE_LABELS[worst], weight: -parts[worst] };
}

// --- KRALIN KENDİ HALKINI FEDA ETMESİ (plan belgesi Fikir 18) --------------

/**
 * GÖÇ KRALIN KENDİ KARARINDAN MI DOĞDU?
 *
 * Plan belgesindeki Fikir 18'in en radikal ucu: Kral kendi rızasını bilerek
 * düşürüp nüfusunu boşaltabilir, ve göç channel'daki başka bir krallığa
 * gittiği için (Faz 6) bu dolaylı bir saldırı aracına dönüşebilir.
 *
 * KARARIN BİRİNCİ MADDESİ: `engine/migration.ts`'in "hedef ADAYLAR arasından
 * seçilir, GÖNDEREN SEÇMEZ" ilkesi KORUNUR. Bu dosyaya ve o dosyaya hiçbir
 * hedefleme aracı eklenmedi ve eklenmeyecek; Kral yalnızca kendi rızasını
 * düşürerek göçü DOLAYLI tetikler, kimin alacağını asla seçemez.
 *
 * KARARIN İKİNCİ MADDESİ — bu fonksiyonun sebebi: doğal rıza/nüfus kaybının
 * ÜSTÜNE, "halk fark ederse" bir itibar cezası devreye girer. "Fark etmek"
 * burada Fikir 14'ün mekanizmasının aynısıdır: halk kalede olan ile kendi
 * yaşadığı arasındaki tutarsızlığı okur. Sebebi zaten hesaplanıyor
 * (`heaviestGrievance`); eksik olan şey SONUÇTU.
 *
 * ASIL AYRIM — ZORLANAN KRAL ile FEDA EDEN KRAL:
 *  - Kral istihkakı TAM ilan etmiş ama ambar yetmiyorsa halk açtır, ama bu bir
 *    feda değil bir DARBOĞAZDIR. İtibar cezası YOK; o durumun karşılığı Fikir
 *    14'ün `vaat` talebidir (halk sesini yükseltir, hesap sorar).
 *  - Kral istihkakı TAM PAYIN ALTINA kendi eliyle indirmişse ya da vergiyi
 *    nötr noktanın üstüne çıkarmışsa, göçün sebebi bir kıtlık değil bir
 *    KARARDIR. İtibar cezası burada devreye girer.
 * Bu ayrım olmadan ceza, zor bir dönemden geçen her Kralı vururdu ve "feda
 * etme" stratejisiyle "kötü şans" arasındaki fark kaybolurdu.
 *
 * `living`, `crowding` ve `raid` gerekçeleri BİLİNÇLİ OLARAK dışarıda: pazar
 * fiyatı, konut tavanı ve dağdan gelen akın Kralın tek bir kolu çevirerek
 * ürettiği sonuçlar değil. İhmal olabilirler ama feda değildirler.
 */
export type ExodusPolicy = { foodRation: number; taxRate: number };

export const EXODUS_PENALTY = {
  /**
   * Göç eden kişi başına itibar cezası.
   *
   * ÖLÇEK MEVCUT BİR SAYIYA DEMİRLENDİ, uydurulmadı: 25 kişi ≈ 10 puan, yani
   * `engine/diplomacy.ts` → `REPUTATION_CHANGES.caught_agitating` ile aynı
   * mertebe. Okunuşu şu: tipik bir krallığın (≈120 kişi) beşte birini bilerek
   * boşaltmak, komşuya kese gönderirken suçüstü yakalanmak kadar itibar
   * götürür. Kişi BAŞINA olması ayrıca kısıt #2'nin gereği (aşağıya bkz.).
   */
  reputationPerPerson: .4,
} as const;

/**
 * Göç bu turda Kralın KENDİ kararından mı doğdu? Öyleyse gerekçe anahtarı,
 * değilse `null`.
 *
 * YALNIZCA KRALIN AYARINA BAKAR — hangi şikâyetin o anda en ağır olduğuna
 * BAKMAZ. Bu, kısıt #2'nin (adım-bölünmesi bağımsızlığı) doğrudan gereği ve
 * ölçülerek öğrenildi:
 *
 * İlk sürüm kapıyı `heaviestGrievance`'a bağlıyordu. O bir KAZANAN-HEPSİNİ-ALIR
 * karşılaştırması, yani hangi kalemin en ağır olduğu adım başındaki duruma
 * bağlı — ve adım büyüklüğü değişince TAKLA ATIYOR. Ölçüm (nüfus 400, kapasite
 * 500, rıza 15, vergi %45, istihkak %40): sunucunun tek büyük adımı cezayı HİÇ
 * uygulamıyordu (itibar 50 kalıyordu), istemcinin dakikalık adımları 24 saatte
 * 20'ye düşürüyordu. Sıfır ile tam ceza arasında 30 puanlık bir fark, çünkü
 * kaba adımda en ağır şikâyet kalabalıklık, ince adımda vergi çıkıyordu.
 *
 * `foodRation` ve `taxRate` ise tur içinde SABİT (yalnızca Kralın emriyle
 * değişir), dolayısıyla kapı her adım büyüklüğünde aynı cevabı verir.
 * Gerekçe seçimi de büyüklük karşılaştırması değil SABİT SIRA: pay kısılmışsa
 * "food", değilse vergi yüksekse "tax". Anlamı da böylesi doğru — Fikir 18
 * "Kral bilerek payı kıstı mı" sorusudur, "hangi şikâyet en gürültülü" değil.
 *
 * Kalan sapma cezanın kendisinden değil `gone` toplamından geliyor: nüfus
 * hareketinin adım-bölünmesi borcu (bkz. `populationChange` ve
 * `docs/plans/2026-08-22-acik-backlog-maddeleri.md`) buraya da taşıyor. O borç
 * bu maddenin kapsamı dışında ve itibar sunucu tarafından üzerine yazıldığı
 * için (`server/save-validation.ts` → `serverDerived`) meşru bir kaydı
 * reddetmiyor.
 */
export function deliberateExodus(policy: ExodusPolicy): GrievanceKey | null {
  // Tam pay ilan edilmişse bu bir darboğazdır, feda değil.
  if (clampRation(policy.foodRation) < FULL_RATION) return "food";
  if ((Number(policy.taxRate) || 0) > TAX_NEUTRAL) return "tax";
  return null;
}

/** Rıza hedefe doğru yürür; ani sıçrama olmaz. */
export function approachMood(current: number, target: number, hours: number) {
  const step = MOOD_APPROACH * hours;
  if (current < target) return Math.min(target, current + step);
  return Math.max(target, current - step);
}

export type MoodState = {
  id: "content" | "uneasy" | "simmering" | "strike" | "revolt";
  label: string;
  /** Üretim çarpanı: iş bırakma ve isyan üretimi düşürür. */
  production: number;
  /**
   * Saatlik nüfus değişimi, mevcut halkın ORANI olarak. Sabit sayı değil:
   * 24 kişilik krallık 24 kişilik hızla toparlanır, 300 kişilik 300 kişilik
   * hızla dağılır. Büyüme ayrıca boş konut kaldıkça yavaşlar (bkz.
   * populationChange), böylece kapasite gerçek bir tavan olur.
   */
  populationRate: number;
  /** Geriye dönük okunabilirlik: 100 kişilik bir krallıkta saatlik değişim. */
  populationPerHour: number;
};

const STATES: Array<{ min: number } & MoodState> = [
  { min: 70, id: "content", label: "Memnun", production: 1.1, populationRate: .05, populationPerHour: 5 },
  { min: 40, id: "uneasy", label: "Huzursuz", production: 1, populationRate: .018, populationPerHour: 1.8 },
  { min: 25, id: "simmering", label: "Kaynıyor", production: 0.75, populationRate: 0, populationPerHour: 0 },
  { min: 10, id: "strike", label: "İş bırakma", production: 0.4, populationRate: -.012, populationPerHour: -1.2 },
  { min: 0, id: "revolt", label: "İsyan", production: 0.05, populationRate: -.03, populationPerHour: -3 },
];

/**
 * Askerler huzursuzluğun DIŞA VURUMUNU bastırır, sebebini değil: aç halk aç
 * kalmaya devam eder ama iş bırakma eşiği yükselir. Maaşı ödenmeyen asker
 * bastırmaz; silahlı isyan sivil isyandan ağırdır.
 */
export function suppression(army: number, population: number, soldierUnrest: number, factionPressure = 0) {
  if (population <= 0 || army <= 0) return 0;
  const ratio = army / population;
  const raw = Math.min(14, ratio * 100 * 0.9);
  const reliability = Math.max(0, 1 - soldierUnrest / 60);
  // Örgütlü muhalefet zapt gücünü kırar: kalabalık artık kimin adamı olduğunu
  // bilmiyordur. Varsayılan 0 olduğu için eski çağrılar aynı sonucu verir.
  return raw * reliability * factionDrag(factionPressure);
}

export function moodState(popularity: number, suppressionBonus: number): MoodState {
  const effective = Math.max(0, Math.min(100, popularity + suppressionBonus));
  return STATES.find(state => effective >= state.min) ?? STATES[STATES.length - 1];
}

/**
 * Asker huzursuzluğu. Maaş eksik ödendikçe birikir, tam ödendikçe erir.
 * 60 üstünde firar başlar, 85 üstünde silahlı isyan.
 */
export function soldierUnrestAfter(current: number, servedPay: number, hours: number) {
  const shortfall = Math.max(0, 100 - servedPay);
  const delta = shortfall > 0 ? shortfall * 0.06 * hours : -4 * hours;
  return Math.max(0, Math.min(100, current + delta));
}

export const SOLDIER_THRESHOLDS = { demand: 30, desertion: 60, mutiny: 85 } as const;

/** Yapıların büyümeye katkısı: meydan ve evlilik dairesi hızı çarpar, taban vermez. */
export function growthMultiplier(buildings: Array<{ type: string; level: number }>) {
  const level = (type: string) => buildings.find(building => building.type === type)?.level ?? 0;
  return 1 + level("town_square") * .05 + level("marriage_hall") * .15;
}

/**
 * Bir saatteki nüfus değişimi.
 *
 * Büyüme lojistiktir: boş konut kaldıkça hızlıdır, kapasite dolarken durur.
 * Kayıp boş konuta bakmaz — insanlar yer olduğu için kalmaz, huzur olduğu
 * için kalır. Kaybın orantılı olması iki şeyi düzeltir: küçük bir krallık
 * dibe vurup orada donmaz, büyük bir krallık da isyanı ucuza atlatamaz.
 */
export function populationChange(
  state: MoodState,
  population: number,
  capacity: number,
  buildings: Array<{ type: string; level: number }>,
  hours: number,
) {
  if (population <= 0 || hours <= 0) return 0;
  if (state.populationRate < 0) return population * state.populationRate * hours;
  const room = capacity > 0 ? Math.max(0, 1 - population / capacity) : 0;
  return population * state.populationRate * growthMultiplier(buildings) * room * hours;
}
