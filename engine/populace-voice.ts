import { COMPARE_BETTER, COMPARE_METRICS, type CompareMetric } from "./comparison";
import { SOLDIER_THRESHOLDS } from "./populace";

/**
 * HALKIN SESİ ve GARNİZON VETOSU.
 *
 * `engine/general-requests.ts`'in birebir aynı şablonu: talep uydurulmaz,
 * KRALLIĞIN DURUMUNDAN türetilir. Aradaki tek fark muhatabıdır — orada konuşan
 * General, burada halkın kendisi ve kışladaki asker.
 *
 * İki taşıyıcı ilke:
 *
 *  1) HALKIN ÜZERİNDE EMİR SÜRECİ YOKTUR. Halkın sesi yeni bir ceza icat etmez;
 *     zaten işleyen bir cezanın (rıza düşüşü, üretim kaybı, göç) okunmasıdır.
 *     Bu yüzden bu dosyada tek bir kaynak/rıza alanı yazılmaz: yalnızca "şu an
 *     hangi talep açık" sorusu cevaplanır.
 *  2) ASKERİN VETOSU AKTİFTİR. Halk direnirse emir gecikir; asker direnirse emir
 *     HİÇ uygulanmaz. Eşikler `populace.SOLDIER_THRESHOLDS` ile aynı yerden
 *     okunur, kopyalanmaz.
 *
 * Modül saftır: veritabanı, tarih ve rastgelelik kullanmaz. Taleplerin ne kadar
 * süredir açık olduğu (`heldGameHours`) çağıran tarafın defterinden gelir
 * (bkz. server/populace-voice.ts).
 */

export type DemandKind = "bread" | "price" | "tax" | "roof" | "joy" | "wage" | "kiyas";

export type DemandSeverity = "normal" | "urgent";

/** Talebi kapatan emirler; `buildingTypes` verilmişse yalnızca o yapı sayılır. */
export type DemandSatisfier = { actions: string[]; buildingTypes?: string[] };

export type DemandCandidate = {
  kind: DemandKind;
  /** Kim konuşuyor? Panel ve sistem promptu iki sesi ayrı gösterir. */
  voice: "commons" | "garrison";
  text: string;
  severity: DemandSeverity;
  /**
   * Koşulun KESİNTİSİZ sürmesi gereken oyun saati. Anlık dalgalanmada talep
   * açılmaz: bir tick'lik istihkak sarsıntısı Kralı masaya çağırmaz.
   */
  minGameHours: number;
  satisfiedBy: DemandSatisfier;
};

/**
 * Eşikler ölçülen "dinlenme noktasının" ALTINDADIR: normal krallık rıza 42-46,
 * iyi yönetilen krallık 62-67'de oturur. Amaç, iyi yönetilen krallıkta hiç
 * talep açılmaması; halkın sesi bir gürültü kaynağı değil, bir uyarı olsun.
 *
 * Süresi planda ayrıca ölçülmemiş kalemlere 2 oyun saati verilir: bu, tek
 * tick'lik dalgalanmayı süzmeye yeten en küçük değer.
 */
export const VOICE_THRESHOLDS = {
  bread: { ration: 85, urgent: 60, hours: 4 },
  price: { index: 1.4, urgent: 1.9, hours: 6 },
  tax: { rate: 28, mood: 40, urgent: 38, hours: 2 },
  roof: { occupancy: .95, urgent: 1, hours: 2 },
  joy: { mood: 38, ration: 90, urgent: 25, hours: 2 },
  wage: { unrest: SOLDIER_THRESHOLDS.demand, urgent: SOLDIER_THRESHOLDS.desertion, hours: 2 },
  /**
   * SESSİZ KIYASLAMA (plan belgesindeki Fikir 13). Diğer kalemler krallığın
   * MUTLAK hâline bakar; bu kalem tek istisnadır: halk kendini komşuların
   * anonim ortalamasıyla kıyaslar.
   *
   * `margin` — bir ölçütte "belirgin geride" saymak için ortalamayla aramızdaki
   * en küçük fark. Ölçekler ortak değil (rıza ve istihkak 0-100, vergi 0-50,
   * muhalefet baskısı 0-100) ve eşikleri tek bir sayıya indirmek yanlış
   * sonuç verirdi, bu yüzden ölçüt başına ayrı yazılır. Değerler her ölçütün
   * kendi ölçülmüş bandından türer:
   *  - rıza 10  → normal krallık 42-46, iyi krallık 62-67'de oturuyor; 20
   *    puanlık bu bandın yarısı, "ölçüm gürültüsü değil, gerçekten geride".
   *  - istihkak 10 → `bread` talebinin eşiğiyle (100 → 85) aynı mertebe.
   *  - vergi 6  → 0-50 bandının yaklaşık sekizde biri; halkın kesesinde
   *    fiilen hissettiği en küçük fark.
   *  - muhalefet 15 → `FACTION_THRESHOLDS.stirring` (20) bir tık altı; iyi
   *    yönetilen krallıkta baskı 0 olduğu için bu fark ancak bizde gerçekten
   *    örgütlenme varken doğar.
   * `metrics` — talebin açılması için kaç ölçütte birden geride olmamız
   * gerektiği. 2 seçildi: TEK ölçütte geride olmak meşru bir tercih olabilir
   * (Kral bilinçli olarak yüksek vergiyle inşaat yapıyordur); iki ölçütte
   * birden geride olmak ise halkın hayatının gerçekten daha zor olması demek.
   * `hours` — 8 oyun saati, listenin en uzunu (`bread`in iki katı). Kıyas bir
   * ACİLİYET değil arka plan sinyali; ayrıca ortalama komşular oynadıkça
   * kayar, kısa bir süre şartı komşunun tek hamlesini bizim halkımızın
   * talebine çevirirdi.
   *
   * `urgent` YOK ve bu KASITLI: kıyas talebi hiçbir zaman acil olmaz, bkz.
   * `comparisonDemand`.
   */
  kiyas: {
    margin: { popularity: 10, foodRation: 10, taxRate: 6, factionPressure: 15 } as Record<CompareMetric, number>,
    metrics: 2,
    hours: 8,
  },
} as const;

/** Aynı anda açık kalabilecek en fazla talep. Kralı yormamanın asıl freni bu. */
export const MAX_OPEN_DEMANDS = 2;

/** Aynı tür için iki bildirim arasındaki en kısa süre (oyun saati). */
export const DEMAND_NOTICE_HOURS = 6;

/** Kapasitenin büyüyebileceği en yüksek seviye; `roof` talebinin ön koşulu. */
const MAX_LEVEL = 6;

export type VoiceSignals = {
  /** Fiilen dağıtılabilen yiyecek istihkakı (%), kâğıt üstündeki oran değil. */
  servedFood: number;
  /** `engine/market.ts → livingCost` geçim endeksi. 1 = normal. */
  livingCost: number;
  taxRate: number;
  popularity: number;
  population: number;
  capacity: number;
  soldierUnrest: number;
  army: number;
  buildings: Array<{ type?: string; level?: number }>;
  /**
   * SESSİZ KIYASLAMA girdisi — DIŞARIDAN gelir, motor veritabanı okumaz
   * (bkz. `server/world-projection.ts` → `populaceComparison`).
   *
   * `mine` ve `averages` AYNI okuyucudan (`engine/comparison.ts` →
   * `compareValuesOf`) doğmak zorundadır; iki taraf ayrı okunsaydı "istihkak
   * kayıtta yoksa varsayılanı kaç" sorusu iki yerde ayrı cevaplanır ve kıyas
   * ölçeğini kaybederdi. Bu yüzden tek bir alan olarak, çift hâlinde taşınır.
   *
   * Alan opsiyoneldir: kıyas girdisi olmayan çağıran (test, eski kayıt, kıyas
   * hesabı yapılamayan istek) için talep hiç açılmaz.
   */
  comparison?: {
    mine: Record<CompareMetric, number>;
    /** Gizlilik alt sınırının altındaysa `null` — o durumda talep AÇILMAZ. */
    averages: Record<CompareMetric, number> | null;
  } | null;
};

const levelOf = (signals: VoiceSignals, type: string) =>
  signals.buildings.find(building => building.type === type)?.level ?? 0;

/**
 * Şu an eşiği aşan talep adayları. Sıra kasıtlıdır: açlık her şeyden önce
 * gelir, sonra maaşsız asker (firar orduyu eritir), sonra geçim, en sonda
 * konfor kalemleri. Panel ve prompt ilk maddeleri öne çıkarır.
 *
 * "DEĞİRMEN DERSİ" (bkz. engine/general-requests.ts): Kralı boş masrafa sokan
 * talep hiç açılmaz. Burada iki yerde uygulanır — `joy` yalnızca karnı tok
 * halkta açılır (aç halk şenliğe sevinmez, para boşa gider) ve `roof` yalnızca
 * kapasitenin gerçekten büyütülebildiği krallıkta açılır (Meydan ve Kale tavana
 * dayanmışsa halkın istediği şey yapılamaz, istemesi de anlamsızdır).
 */
export function derivePopulaceDemands(signals: VoiceSignals): DemandCandidate[] {
  const demands: DemandCandidate[] = [];
  const food = Number(signals.servedFood) || 0;
  const index = Number.isFinite(signals.livingCost) ? signals.livingCost : 1;
  const mood = Number(signals.popularity) || 0;
  const unrest = Number(signals.soldierUnrest) || 0;
  const army = Math.max(0, Number(signals.army) || 0);
  const occupancy = signals.capacity > 0 ? signals.population / signals.capacity : 0;

  if (food < VOICE_THRESHOLDS.bread.ration) {
    demands.push({
      kind: "bread", voice: "commons",
      severity: food < VOICE_THRESHOLDS.bread.urgent ? "urgent" : "normal",
      minGameHours: VOICE_THRESHOLDS.bread.hours,
      text: food < VOICE_THRESHOLDS.bread.urgent
        ? `Halk ekmek istiyor: istihkak %${Math.round(food)}'e indi, çocuklar aç yatıyor.`
        : `Halk istihkakın %${Math.round(food)}'e inmesinden şikâyetçi; tam pay bekliyorlar.`,
      satisfiedBy: { actions: ["set_food_ration"] },
    });
  }

  // Maaşsız asker halkın değil garnizonun sesidir; ikisi aynı listede taşınır
  // ama `voice` ile ayrılır, çünkü Kralın verdiği cevap da farklıdır.
  if (army > 0 && unrest >= VOICE_THRESHOLDS.wage.unrest) {
    demands.push({
      kind: "wage", voice: "garrison",
      severity: unrest >= VOICE_THRESHOLDS.wage.urgent ? "urgent" : "normal",
      minGameHours: VOICE_THRESHOLDS.wage.hours,
      text: unrest >= VOICE_THRESHOLDS.wage.urgent
        ? `Kışlada firar başladı; huzursuzluk ${Math.round(unrest)} puan. Adamlar maaş defterinin açılmasını istiyor.`
        : `Garnizon maaşını istiyor; huzursuzluk ${Math.round(unrest)} puana çıktı.`,
      satisfiedBy: { actions: ["set_soldier_pay"] },
    });
  }

  if (index > VOICE_THRESHOLDS.price.index) {
    demands.push({
      kind: "price", voice: "commons",
      severity: index > VOICE_THRESHOLDS.price.urgent ? "urgent" : "normal",
      minGameHours: VOICE_THRESHOLDS.price.hours,
      text: `Pazarda ekmek normalin ${index.toFixed(2)} katı; halk kalenin ambarını açmasını istiyor.`,
      satisfiedBy: { actions: ["trade_resource", "set_food_ration"] },
    });
  }

  if (signals.taxRate > VOICE_THRESHOLDS.tax.rate && mood < VOICE_THRESHOLDS.tax.mood) {
    demands.push({
      kind: "tax", voice: "commons",
      severity: mood < VOICE_THRESHOLDS.tax.urgent ? "urgent" : "normal",
      minGameHours: VOICE_THRESHOLDS.tax.hours,
      text: `Halk %${Math.round(signals.taxRate)} verginin indirilmesini istiyor; rıza ${Math.round(mood)} puana düştü.`,
      satisfiedBy: { actions: ["set_tax_rate"] },
    });
  }

  // Değirmen dersi: kapasite tavana dayanmışsa halkın konut istemesi Kralı
  // yapılamayacak bir işe çağırır; talep hiç açılmaz.
  const canGrow = levelOf(signals, "town_square") < MAX_LEVEL || levelOf(signals, "keep") < MAX_LEVEL;
  if (occupancy > VOICE_THRESHOLDS.roof.occupancy && canGrow) {
    demands.push({
      kind: "roof", voice: "commons",
      severity: occupancy >= VOICE_THRESHOLDS.roof.urgent ? "urgent" : "normal",
      minGameHours: VOICE_THRESHOLDS.roof.hours,
      text: `Konutlar %${Math.round(occupancy * 100)} dolu; halk damaltı istiyor.`,
      satisfiedBy: { actions: ["build_structure"], buildingTypes: ["town_square", "keep"] },
    });
  }

  // Değirmen dersi: aç halka şenlik boş masraftır, bu yüzden istihkak eşiği ön koşul.
  if (mood < VOICE_THRESHOLDS.joy.mood && food >= VOICE_THRESHOLDS.joy.ration) {
    demands.push({
      kind: "joy", voice: "commons",
      severity: mood < VOICE_THRESHOLDS.joy.urgent ? "urgent" : "normal",
      minGameHours: VOICE_THRESHOLDS.joy.hours,
      text: `Karınları tok ama rıza ${Math.round(mood)} puan; halk bir şenlik ya da meydan eğlencesi bekliyor.`,
      satisfiedBy: { actions: ["host_festival", "set_ale_ration", "build_structure"], buildingTypes: ["park", "theater", "town_square"] },
    });
  }

  // Kıyas EN SONDA: plan belgesinin kendi açık sorusu ("kıyas talebi diğer daha
  // somut taleplerin önüne geçip yer kaplayabilir") burada iki tedbirle
  // cevaplanıyor — sırada en arkada durur ve asla `urgent` olmaz.
  const comparison = comparisonDemand(signals);
  if (comparison) demands.push(comparison);

  return demands;
}

/** Geride olduğumuz ölçütün halkın dilindeki NİTEL karşılığı — sayı YOK. */
const COMPARE_COMPLAINT: Record<CompareMetric, string> = {
  popularity: "orada halkın yüzü daha gülüyormuş",
  foodRation: "oradaki sofralar bizimkinden dolu",
  taxRate: "oradaki vergi yükü bizimki kadar ağır değil",
  factionPressure: "orada muhalefetin sesi bizdeki kadar yüksek değil",
};

/**
 * Bir ölçütteki geriliği kapatabilecek emirler. Talep yalnızca GERÇEKTEN geride
 * olduğumuz ölçütlerin emirleriyle kapanır: "değirmen dersi"nin bu talepteki
 * karşılığı, Kralı ilgisiz bir masrafa çağırmamaktır.
 */
const COMPARE_REMEDY: Record<CompareMetric, string[]> = {
  popularity: ["host_festival", "set_ale_ration"],
  foodRation: ["set_food_ration"],
  taxRate: ["set_tax_rate"],
  // Muhalefet baskısı yalnızca rıza yükselince erir (bkz. engine/faction.ts:
  // bastırma emri YOK), o yüzden çare rızayı yükselten emirlerdir.
  factionPressure: ["host_festival", "set_ale_ration", "set_tax_rate"],
};

/**
 * SESSİZ KIYASLAMA (plan belgesindeki Fikir 13) — halk kendi mutlak hâline
 * değil, komşu sancakların ANONİM ortalamasına da bakar.
 *
 * BİLGİ AKIŞI TEK YÖNLÜ. Halk kıyaslar, sonuç Krala BASKI olarak gelir; Kral bu
 * yolla komşunun verisine ASLA erişmez. Bu yüzden metnin iki kesin sınırı var
 * ve `tests/populace-voice.test.ts` ikisini de doğruluyor:
 *  1) hiçbir krallık adı/kimliği geçmez — ortalama isimsizdir, cümle de
 *     isimsiz kalır ("komşu sancaklarda");
 *  2) HİÇ SAYI geçmez — "komşu sancakta vergi %12" cümlesi Krala komşunun
 *     verisini birebir verirdi. Yalnızca NİTEL bir kıyas kurulur.
 * Diğer taleplerin metni sayı taşır (istihkak %70, huzursuzluk 90 puan) çünkü
 * o sayılar Kralın KENDİ krallığına ait; burada sayı karşı tarafa ait olurdu.
 *
 * "DEĞİRMEN DERSİ" burada da geçerli ve en sert hâliyle: ortalama YOKSA
 * (`averages: null`, yani gizlilik alt sınırının altındaki channel) talep
 * KESİNLİKLE açılmaz. Dayanağı olmayan bir kıyas Kralı ölçüsüz bir işe çağırır;
 * üstelik sayı üretilmediği için halkın kıyaslayacağı bir şey de yoktur.
 */
function comparisonDemand(signals: VoiceSignals): DemandCandidate | null {
  const comparison = signals.comparison;
  if (!comparison || !comparison.averages) return null;
  const averages = comparison.averages;
  const rule = VOICE_THRESHOLDS.kiyas;
  // Hangi ölçütte "iyi" hangi yöndedir sorusu MOTORDA TEK YERDE duruyor
  // (`COMPARE_BETTER`); burada yeniden yazılsaydı yeni bir ölçüt eklendiğinde
  // halk yüksek vergiyi iyi sayabilirdi.
  const behind = COMPARE_METRICS.filter(metric => {
    const gap = averages[metric] - (Number(comparison.mine[metric]) || 0);
    return (COMPARE_BETTER[metric] === "high" ? gap : -gap) >= rule.margin[metric];
  });
  if (behind.length < rule.metrics) return null;
  return {
    kind: "kiyas", voice: "commons",
    // ASLA `urgent` olmaz: açlık ya da firar gibi bir acil talep varken kıyas
    // tavandaki yeri ondan almasın (bkz. `openDemands` sıralaması).
    severity: "normal",
    minGameHours: rule.hours,
    text: `Halk komşu sancaklarla kendini kıyaslıyor: ${behind.map(metric => COMPARE_COMPLAINT[metric]).join(", ")} diyorlar. Aynı düzeni kendi kapılarında istiyorlar.`,
    satisfiedBy: { actions: [...new Set(behind.flatMap(metric => COMPARE_REMEDY[metric]))] },
  };
}

/**
 * Süre şartını ve tavanı uygulayarak açık talepleri süzer.
 *
 * `heldGameHours` her tür için koşulun kesintisiz kaç OYUN saati sürdüğünü
 * söyler; defteri çağıran taraf tutar. Tavan en sonda uygulanır ki en acil
 * talepler kesilen değil kalan taraf olsun.
 */
export function openDemands(
  candidates: DemandCandidate[],
  heldGameHours: Partial<Record<DemandKind, number>>,
): DemandCandidate[] {
  return candidates
    .filter(candidate => (heldGameHours[candidate.kind] ?? 0) >= candidate.minGameHours)
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "urgent" ? -1 : 1))
    .slice(0, MAX_OPEN_DEMANDS);
}

/** Bu turda uygulanan emirler hangi talepleri kapatıyor? */
export function demandsSatisfiedBy(
  demands: Array<{ kind: DemandKind; satisfiedBy: DemandSatisfier }>,
  actions: Array<{ name: string; arguments?: Record<string, unknown> }>,
): DemandKind[] {
  return demands
    .filter(demand => actions.some(action => {
      if (!demand.satisfiedBy.actions.includes(action.name)) return false;
      const types = demand.satisfiedBy.buildingTypes;
      if (!types || action.name !== "build_structure") return true;
      return types.includes(String(action.arguments?.building_type ?? ""));
    }))
    .map(demand => demand.kind);
}

/** Talepleri modele ve panele verilecek kısa metne çevirir. */
export function renderDemands(demands: Array<{ text: string; severity: DemandSeverity; voice: DemandCandidate["voice"] }>): string {
  if (!demands.length) return "";
  return demands
    .map(demand => `- ${demand.severity === "urgent" ? "[ACİL] " : ""}${demand.voice === "garrison" ? "Garnizon" : "Halk"}: ${demand.text}`)
    .join("\n");
}

// --- GARNİZON VETOSU -------------------------------------------------------

/**
 * Askerin reddettiği emirler. `raise_watch` yalnızca YÜKSELTMEYİ kapsar:
 * huzursuz asker nöbeti uzatmayı reddeder ama kısaltmayı memnuniyetle kabul
 * eder, yoksa Kralın elinde tek bir çıkış bile kalmazdı.
 *
 * ≥85 satırı Kralın açıkça onayladığı bir sertleştirmedir: isyan hâlindeki ordu
 * maaş defterine de el sürmez, yani Kral GERÇEKTEN çıkışsız kalabilir. Bu,
 * "her zaman bir çıkış kapısı" ilkesinin bilinçli istisnasıdır.
 */
export type VetoOrder = "train_unit" | "raise_watch" | "set_soldier_pay";

export const GARRISON_VETOES: ReadonlyArray<{ order: VetoOrder; unrest: number }> = [
  { order: "train_unit", unrest: SOLDIER_THRESHOLDS.demand },
  { order: "raise_watch", unrest: SOLDIER_THRESHOLDS.desertion },
  { order: "set_soldier_pay", unrest: SOLDIER_THRESHOLDS.mutiny },
];

/** Şu anda reddedilen emirler. Askeri olmayan krallıkta veto yoktur. */
export function garrisonVetoes(unrest: number, army: number): VetoOrder[] {
  if (!(army > 0)) return [];
  const level = Math.max(0, Number(unrest) || 0);
  return GARRISON_VETOES.filter(veto => level >= veto.unrest).map(veto => veto.order);
}

/** Emir reddediliyorsa Kral'a gösterilecek gerekçe; aksi hâlde null. */
export function garrisonRefusal(order: VetoOrder, unrest: number, army: number): string | null {
  if (!garrisonVetoes(unrest, army).includes(order)) return null;
  const level = Math.round(Math.max(0, Number(unrest) || 0));
  if (order === "train_unit") {
    return `Kışla yeni asker almayı reddetti: kendi maaşları eksik ödenmişken kışlaya yeni ağız sokmuyorlar (huzursuzluk ${level}). Maaşı toparlamadan eğitim yürümez.`;
  }
  if (order === "raise_watch") {
    return `Garnizon nöbeti uzatmayı reddetti: firar başlamışken kalan adamlar daha uzun nöbete kalmıyor (huzursuzluk ${level}). Nöbeti indirmeye itirazları yok.`;
  }
  return `Ordu isyan hâlinde; maaş defterine el sürmüyorlar (huzursuzluk ${level}). Bu kilidin dışarıdan bir çıkışı yok — kışla ancak kendi içinde sakinleşirse açılır.`;
}

export type GarrisonMood = {
  id: "absent" | "steady" | "demanding" | "deserting" | "mutinous";
  label: string;
  note: string;
};

/** Garnizonun tek cümlelik hâli. Panel ve prompt aynı yerden okur. */
export function garrisonMood(unrest: number, army: number): GarrisonMood {
  if (!(army > 0)) return { id: "absent", label: "Garnizon yok", note: "Silah altında kimse yok; kışla sessiz." };
  const level = Math.max(0, Number(unrest) || 0);
  if (level >= SOLDIER_THRESHOLDS.mutiny) {
    return { id: "mutinous", label: "İsyan", note: "Ordu isyan etti: halkı zapt etmiyor, yeni asker almıyor, nöbeti uzatmıyor ve maaş defterine el sürmüyor." };
  }
  if (level >= SOLDIER_THRESHOLDS.desertion) {
    return { id: "deserting", label: "Firar", note: "Firar başladı: nöbet yükseltme emri geri çevrilir, yeni eğitim yürümez." };
  }
  if (level >= SOLDIER_THRESHOLDS.demand) {
    return { id: "demanding", label: "Maaş istiyor", note: "Adamlar maaşını istiyor: yeni asker eğitimi geri çevrilir." };
  }
  return { id: "steady", label: "Sakin", note: "Kışla sakin; bütün emirler yürür." };
}
