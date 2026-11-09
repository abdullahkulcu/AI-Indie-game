/**
 * İÇ MUHALEFET — rıza uzun süre düşük kalınca krallığın içinde bir elebaşı çıkar.
 *
 * Bu mekanik halka verilen bir CEZA DEĞİL, halkın kendi hareketidir. Bu yüzden
 * Kralın elinde onu bastıracak bir düğme yoktur: "elebaşını astır" diye bir
 * emir icat edilmedi ve edilmeyecek — bu, "halka emir verilmez" ilkesinin
 * doğrudan sonucudur. Muhalefet yalnızca YÖNETİMLE, yani rızayı yükselterek erir.
 *
 * TERİM NOTU: bu mekaniğe eskiden "hizip" deniyordu; oyuncuya daha anlaşılır
 * olsun diye tüm görünen metinler "muhalefet" olarak değiştirildi. Kod içindeki
 * `faction*` adları (İngilizce) DEĞİŞMEDİ — dolayısıyla alan adı, tip adı ve
 * `factionLeaderName`'in TOHUM DİZGESİ olduğu gibi kaldı (bkz. aşağıdaki not:
 * tohum değişirse her krallığın elebaşısının adı değişirdi).
 *
 * Baskı (0-100) kapalı çözümlü üstel biriktirilir/eritilir:
 *
 *     dx/dt = k · (hedef − x)
 *     x(h)  = hedef + (x0 − hedef) · e^(−k·h)
 *
 * Üstel fonksiyon tam olarak bölünebilirdir (e^(−k·6) = (e^(−k))^6), yani
 * istemcinin saniyelik adımları ile sunucunun tek adımı BİREBİR aynı sonucu
 * verir — `advanceCommons` ve `RAID_TRAUMA` ile aynı desen. Birikim ve erime
 * hızları farklıdır; bu bölünebilirliği bozmaz çünkü x bir adım içinde hedefe
 * doğru tek yönde yürür, işaret adım ortasında dönmez.
 *
 * Zar yoktur. Elebaşının adı `engine/general-name.ts` deseniyle tohumdan türer.
 */

const FACTION = {
  /**
   * Rıza bu eşiğin ÜSTÜNDEyken muhalefet hedefi sıfırdır, yani muhalefet erir.
   * 40, halkın "Huzursuz"dan "Kaynıyor"a geçtiği sınırdır: ölçülen dinlenme
   * noktaları (normal krallık 42-46, iyi krallık 62-67) bu eşiğin üstünde
   * oturuyor, dolayısıyla düzgün yönetilen krallıkta muhalefet hiç doğmaz.
   */
  moodFloor: 40,
  /** Eşiğin altındaki her rıza puanının hedefe kattığı baskı. */
  slope: 7.5,
  /** Birikim hızı (1/oyun saati). Rıza 30'da 24 saatte 0 → 61 puan. */
  riseRate: .07,
  /** Erime hızı (1/oyun saati). Rıza 60'a dönünce 12 saatte 60 → 16 puan. */
  easeRate: .11,
  /**
   * Askerin zapt gücünü tamamen kıran baskı. Muhalefet büyüdükçe garnizonun halkı
   * bastırma gücü zayıflar: kalabalık artık kimin adamı olduğunu bilmiyordur.
   */
  suppressionBreak: 100,
} as const;

/**
 * Kral tam istihkak/maaş ilan ettiği hâlde fiilen ulaştıramadığında halkın
 * güveni yalnız düşük rızadan daha hızlı çözülür. Eşik, tek saatlik küçük
 * ambar dalgalanmasını siyasi krize çevirmemek için Halk Sesi'nin `shortfall`
 * eşiğiyle aynı tutulur.
 */
export const PROMISE_BREACH = {
  gap: 20,
  /** İhlal çok büyükse muhalefetin hedefi doğrudan tavana yaklaşır. */
  targetAtGap: 20,
  targetPerGap: 1.25,
  /** Sözün tutulmadığı açıkça görünürken normalden hızlı örgütlenme. */
  riseRate: .16,
} as const;

export const FACTION_LIMITS = { min: 0, max: 100 } as const;

/** Baskının eşikleri; panel, bildirim ve prompt aynı listeden okur. */
export const FACTION_THRESHOLDS = { stirring: 20, organized: 50, defiant: 80 } as const;

/** Divan gündemi görmezden gelinince açık şikâyetin baskıya eklediği oyun saati. */
export const COUNCIL_NEGLECT_HOURS = { watch: 3, urgent: 6 } as const;

/**
 * ÖRGÜTLÜ MUHALEFETİN KOALİSYON TALEBİ.
 *
 * Talebin CÜMLESİ Halk-AI tarafından üretilir; fakat neyin istenebileceği ve
 * kabul edildiğinde hangi politikanın değişeceği motorun tek, denetlenebilir
 * kuralıdır. Böylece bir model "hazineyi bana ver" yazsa bile oyun kuralı
 * değişmez. Bu liste özellikle General'in dış krallık müzakeresinden ayrıdır.
 */
export const FACTION_DEMAND_KINDS = ["tax_relief", "food_relief"] as const;
export type FactionDemandKind = typeof FACTION_DEMAND_KINDS[number];
export type FactionDemand = {
  kind: FactionDemandKind;
  policy: { key: "taxRate" | "foodRation"; value: number };
  /** Anlatıcıya giden, sayısal olmayan kısa konu. */
  subject: string;
};

/** Yalnız örgütlü muhalefet masa kurabilir; öncelik önce ağır vergi, sonra sofradır. */
export function factionDemandOf(game: { factionPressure?: number; taxRate: number; foodRation?: number }): FactionDemand | null {
  if (factionPressureOf(game) < FACTION_THRESHOLDS.organized) return null;
  const tax = Math.max(0, Math.min(50, Math.round(Number(game.taxRate) || 0)));
  if (tax > 10) return {
    kind: "tax_relief",
    policy: { key: "taxRate", value: Math.max(10, tax - 10) },
    subject: "Meydanın sözcüsü ağır verginin hafifletilmesini istiyor.",
  };
  const food = Math.max(0, Math.min(200, Math.round(Number(game.foodRation) || 100)));
  if (food < 100) return {
    kind: "food_relief",
    policy: { key: "foodRation", value: 100 },
    subject: "Meydanın sözcüsü sofraların yeniden tam kurulmasını istiyor.",
  };
  return null;
}

/**
 * Masa sonucunun sayısal etkisi. Kabul, normal rıza iyileşmesinden daha hızlı
 * bir güven onarımıdır; ret ise baskıyı yükseltir fakat hiçbir zaman 100'ü
 * geçmez. Metnin sertliği `refusalCount` ile anlatıcıya taşınır.
 */
export function factionSettlement(pressure: number, decision: "accept" | "decline", refusalCount = 0) {
  const current = factionPressureOf({ factionPressure: pressure });
  if (decision === "accept") return { pressure: Math.max(0, current - 32), tone: "conciliatory" as const };
  const escalation = 6 + Math.min(12, Math.max(0, Math.floor(refusalCount)) * 2);
  return { pressure: Math.min(100, current + escalation), tone: "hardened" as const };
}

export const factionPressureOf = (game: { factionPressure?: number }) =>
  Math.max(FACTION_LIMITS.min, Math.min(FACTION_LIMITS.max, Number(game.factionPressure) || 0));

/**
 * Mevcut rızanın işaret ettiği muhalefet baskısı. Rıza eşiğin üstündeyse 0: muhalefet
 * kendi kendine büyümez, ancak memnuniyetsizlikten beslenir.
 */
export function factionTarget(popularity: number) {
  const mood = Number.isFinite(popularity) ? popularity : 50;
  const raw = (FACTION.moodFloor - mood) * FACTION.slope;
  return Math.max(FACTION_LIMITS.min, Math.min(FACTION_LIMITS.max, raw));
}

/**
 * Ferman ile fiili dağıtım arasındaki farkın işaret ettiği hedef baskı.
 *
 * Bu fonksiyon "Kral bunu bilerek yaptı" diye niyet okuyamaz; yalnızca
 * halkın herkesçe görünen bir sözü ile yaşanan sonucu karşılaştırır. Aynı
 * nedenle rıza hedefini asla düşürmez, yalnız tutulmayan bir söz varsa onun
 * üstüne çıkar.
 */
export function brokenPromiseTarget(
  popularity: number,
  declaredFood: number,
  servedFood: number,
  declaredPay: number,
  servedPay: number,
) {
  const normal = factionTarget(popularity);
  const gap = Math.max(0, (Number(declaredFood) || 0) - (Number(servedFood) || 0), (Number(declaredPay) || 0) - (Number(servedPay) || 0));
  if (gap < PROMISE_BREACH.gap) return normal;
  const breach = PROMISE_BREACH.targetAtGap + (gap - PROMISE_BREACH.gap) * PROMISE_BREACH.targetPerGap;
  return Math.max(normal, Math.min(FACTION_LIMITS.max, breach));
}

function advanceFactionToTarget(current: number, target: number, hours: number, riseRate: number) {
  const start = Math.max(FACTION_LIMITS.min, Math.min(FACTION_LIMITS.max, Number(current) || 0));
  if (!(hours > 0)) return start;
  const rate = start < target ? riseRate : FACTION.easeRate;
  const next = target + (start - target) * Math.exp(-rate * hours);
  return Math.max(FACTION_LIMITS.min, Math.min(FACTION_LIMITS.max, next));
}

/**
 * Baskıyı `hours` kadar ilerletir. `boost` dış müdahalenin (yabancı kesenin)
 * o pencerede eklediği puandır; hedefe değil doğrudan baskıya eklenir, çünkü
 * kese rızayı değiştirmez — yalnızca var olan hoşnutsuzluğu örgütler.
 */
export function advanceFaction(current: number, popularity: number, hours: number, boost = 0) {
  const start = Math.max(FACTION_LIMITS.min, Math.min(FACTION_LIMITS.max, Number(current) || 0))
    + Math.max(0, Number(boost) || 0);
  return advanceFactionToTarget(start, factionTarget(popularity), hours, FACTION.riseRate);
}

/** Tutulmayan ferman, var olan rıza hedefinin üstünde daha hızlı baskı üretir. */
export function advanceBrokenPromiseFaction(
  current: number,
  popularity: number,
  declaredFood: number,
  servedFood: number,
  declaredPay: number,
  servedPay: number,
  hours: number,
) {
  const target = brokenPromiseTarget(popularity, declaredFood, servedFood, declaredPay, servedPay);
  const gap = Math.max(0, declaredFood - servedFood, declaredPay - servedPay);
  const rate = gap >= PROMISE_BREACH.gap ? PROMISE_BREACH.riseRate : FACTION.riseRate;
  return advanceFactionToTarget(current, target, hours, rate);
}

/**
 * Açık bir Divan gündemini bir oyun günü boyunca kapatmamak, mevcut halk
 * baskısının aynı sorun altında biraz daha hızlı büyümesine yol açar. Bu bir
 * kaynak cezası değildir: yalnız zaten rızanın işaret ettiği hedefe doğru
 * yürüyüşü birkaç oyun saati öne çeker. Rıza toparlanmışsa ceza tersine
 * çalışıp baskıyı azaltmaz.
 */
export function councilNeglectPressure(current: number, popularity: number, priority: "watch" | "urgent") {
  const pressure = factionPressureOf({ factionPressure: current });
  if (factionTarget(popularity) <= pressure) return pressure;
  return advanceFaction(pressure, popularity, COUNCIL_NEGLECT_HOURS[priority]);
}

/**
 * Muhalefetin askerin zapt gücüne çarpanı. 1 = muhalefet yok, 0 = garnizon halkı
 * hiç bastıramıyor. `populace.suppression()` bunu `reliability` ile birlikte uygular.
 */
export function factionDrag(pressure: number) {
  const level = Math.max(0, Math.min(FACTION_LIMITS.max, Number(pressure) || 0));
  return Math.max(0, 1 - level / FACTION.suppressionBreak);
}

export type FactionState = {
  id: "none" | "stirring" | "organized" | "defiant";
  label: string;
  note: string;
};

export function factionState(pressure: number): FactionState {
  const level = Math.max(0, Number(pressure) || 0);
  if (level >= FACTION_THRESHOLDS.defiant) {
    return { id: "defiant", label: "Açık meydan okuma", note: "Muhalefet sokakta açıkça toplanıyor; garnizonun zapt gücü neredeyse kalmadı." };
  }
  if (level >= FACTION_THRESHOLDS.organized) {
    return { id: "organized", label: "Örgütlü muhalefet", note: "Bir elebaşı çıktı ve halkın bir bölümü onun sözünü dinliyor." };
  }
  if (level >= FACTION_THRESHOLDS.stirring) {
    return { id: "stirring", label: "Kıpırdanma", note: "Kahvelerde fısıltı var; henüz bir önder yok." };
  }
  return { id: "none", label: "Muhalefet yok", note: "Krallıkta örgütlü bir muhalefet yok." };
}

// --- Elebaşının adı --------------------------------------------------------

const LEADERS = [
  "Balaban", "Cüneyt", "Davut", "Emrah", "Fettah", "Gündüz", "Hüsam", "İsfendiyar",
  "Karaca", "Lütfi", "Mahmut", "Nasuh", "Osman", "Pervane", "Recep", "Sadık",
  "Şahin", "Tuğrul", "Umut", "Veli", "Yılmaz", "Ziya", "Bekir", "Cafer",
] as const;

const EPITHETS = ["Değirmenci", "Demirci", "Dokumacı", "Fırıncı", "Kayıkçı", "Tuzcu", "Yorgancı", "Nalbant"] as const;

/** FNV-1a; motorun her yerinde kullanılan aynı karma. */
function hash(text: string) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/**
 * Muhalefetin elebaşı. Tohum krallığın adı ve kuruluş anıdır: ad hiçbir yerde
 * saklanmasa da aynı krallıkta hep aynı çıkar, farklı krallıklarda farklı olur.
 *
 * TOHUM DİZGESİ ("hizip") DEĞİŞTİRİLEMEZ. Terim "muhalefet"e çevrildiğinde bu
 * dizgeyi de güncellemek doğal görünüyor ama YAPILMAMALI: tohum değişirse hash
 * değişir, hash değişirse HER MEVCUT KRALLIĞIN elebaşısı bir gecede başka biri
 * olur. Oyuncunun aylardır tanıdığı isim kaybolur. Dizge burada bir kimliktir,
 * bir metin değil.
 */
export function factionLeaderName(kingdomName: string, foundedAt: number) {
  const seed = hash(`${kingdomName}|${foundedAt}|hizip`);
  const name = LEADERS[seed % LEADERS.length];
  const epithet = EPITHETS[Math.floor(seed / LEADERS.length) % EPITHETS.length];
  return `${epithet} ${name}`;
}

/** Eşik geçişlerinde Kral'a yazılan bildirim; her eşik bir kez konuşur. */
export function factionNotice(previous: number, current: number, kingdomName: string, foundedAt: number): string | null {
  const crossed = (limit: number) => current >= limit && previous < limit;
  if (crossed(FACTION_THRESHOLDS.defiant)) {
    return `${factionLeaderName(kingdomName, foundedAt)} meydanda açıkça konuşuyor; asker kalabalığı dağıtamıyor. Bunu ancak halkın rızasını yükselterek çözebilirsiniz.`;
  }
  if (crossed(FACTION_THRESHOLDS.organized)) {
    return `Halkın hoşnutsuzluğu bir isme bağlandı: ${factionLeaderName(kingdomName, foundedAt)}. Muhalefet artık örgütlü ve garnizonun zapt gücünü zayıflatıyor.`;
  }
  if (crossed(FACTION_THRESHOLDS.stirring)) {
    return "Kahvelerde ve tezgâh başlarında hoşnutsuz bir fısıltı dolaşıyor; henüz bir önder yok.";
  }
  return null;
}
