import { BASE_PRICE, TRADED_KEYS } from "./market";
import type { Game, TradeKey } from "./types";

/**
 * DIŞ KESE — komşu krallığın halkına ya da askerine gönderilen para.
 *
 * Kral 600 altın karşılığında bir kese yollar; kese hedefin HALKINA giderse
 * oradaki hoşnutsuzluğu örgütler (muhalefet baskısı), ASKERİNE giderse doğrudan
 * huzursuzluk enjekte eder. Kese rızayı değiştirmez: var olmayan bir
 * memnuniyetsizliği yaratmaz, var olanı çalıştırır.
 *
 * Üç taşıyıcı ilke:
 *
 *  1) ZAR YOK. Kese gerçek para harcadığı için "başarı ihtimali" yoktur; etkisi
 *     kesindir, yalnızca ifşa iki kademelidir ve o da zara değil hedefin
 *     karşı-istihbarat kurup kurmadığına bağlıdır.
 *  2) HEDEFTE HİÇBİR KAYNAK ALANI YAZILMAZ. Etki yalnızca üç taşıyıcı alana
 *     yazılır (`agitationPressure`, `agitationBribe`, `agitationAt`) ve üçü de
 *     sunucu-türevidir. Kese bir kaynak transferi değildir.
 *  3) SÖNÜM KAPALI ÇÖZÜMLÜ VE DAMGA TABANLI. Alanlar `agitationAt` ANINDAKİ
 *     değeri taşır; okuyan taraf o damgadan bugüne kadar sönümü kendi hesaplar.
 *     Böylece cron'un gecikmesi sonucu DEĞİŞTİRMEZ: etki `completesAt` anına
 *     geriye dönük damgalanır ve iki ayrı okuma aynı sayıyı verir.
 *
 * Verim karşılaştırması (ölçüldü): yabancının altını, hedefin kendi maaşını
 * ödememesinden yaklaşık 14 kat verimsizdir. Kese bir sabotaj aracıdır, savaşın
 * yerini tutmaz.
 */

export type AgitationKind = "gold_commons" | "gold_garrison" | "goods_glut" | "raid_lure";

export const AGITATION = {
  /** Sabit fiyat. Serbest miktar yok: 600, doğrulayıcının 250 altınlık
   *  toleransının (SIMULATION_FLOOR) 2,4 katı — keseye saklanamaz. */
  cost: 600,
  /** Kesenin yola çıkışından etkisine kadar geçen OYUN dakikası. */
  travelMinutes: 45,
  /**
   * Halka giden kese: muhalefet baskısına eklenen puan. Tavan 11,5 — şenliğin
   * rızaya kattığı 12 puanın ALTINDA, yani hedef Kral tek bir şenlikle
   * yabancının bütün emeğini silebilir.
   */
  commons: { perPurse: 9.6, cap: 11.5 },
  /**
   * Askere giden kese: huzursuzluğa eklenen puan. Tavan 18 —
   * SOLDIER_THRESHOLDS.demand (30) eşiğinin ALTINDA, yani tek kese (hatta
   * üst üste keseler) tek başına orduyu dağıtamaz.
   */
  garrison: { perPurse: 12, cap: 18 },
  /** Sönüm zaman sabiti (oyun saati). Kalkan altında 3'e iner. */
  tau: 8,
  shieldedTau: 3,
  /** Yakalanan kesenin hedefe verdiği kalkan süresi (oyun saati). */
  shieldHours: 12,
  /** Kalkan altındaki hedefe gelen kesenin etkisi yarıya iner. */
  shieldedShare: .5,
  /** Tavanlar: gönderen başına oyun-günü, hedef başına oyun-günü, çift arası bekleme. */
  perSenderPerDay: 4,
  perTargetPerDay: 3,
  pairWaitHours: 6,
} as const;

/**
 * MAL KESESİ (pazar bozma). Kral kendi ambarından mal çıkarıp hedefin halkına
 * yığar; amaç kaynak vermek değil, hedefin PAZARINI bozmaktır.
 *
 * Düz `commons`'a yazmak iki TERS etki üretiyordu: hedef şişirilen malın büyük
 * bölümünü ucuza satın alıp kendi ambarına koyabiliyordu, ve şişen stok hedefin
 * RIZASINI yükseltiyordu (bol mal = memnun halk). Bu yüzden yığın ayrı bir
 * taşıyıcıda (`commonsGlut`) durur ve fiyat hesabının YALNIZCA SATIŞ koluna
 * girer (bkz. engine/market.ts → fillOrder / marketPrices).
 *
 * Ölçülen etki, üç sabitin (pay, sönüm, bekleme) çarpımından KENDİLİĞİNDEN
 * çıkar: tek kese satış getirisini %33 düşürür; 6 oyun saati arayla art arda
 * gönderilen keseler dengeye oturur (0,6 / (1 − e^(−6/8)) ≈ 1,137 referans
 * katı) ve kalıcı düşüş %62,5 olur. Fiyat modelinin tabanına (kapsama 2,2727)
 * hiçbir zaman çakmaz, yani pazar "her zaman bozuk ama tek seferde deşifre
 * olmayan" hâlde kalır.
 */
export const GLUT = {
  /** Tek kesenin yığdığı mal, referans stoğun katı olarak. */
  perPurse: .6,
  /** Emniyet tavanı; dengenin (≈1,137) üstünde ve fiyat tabanının (1,2727) altında. */
  cap: 1.2,
  /** Taban maliyet: 900 yiyecek. Diğer mallar aynı ALTIN DEĞERİNE göre ölçülür. */
  baseCost: 900,
} as const;

/** Malın eşdeğer miktarı: 900 yiyeceğin altın karşılığı kaç birim eder? */
export function glutCost(key: TradeKey) {
  return Math.max(1, Math.ceil(GLUT.baseCost * BASE_PRICE.food / BASE_PRICE[key]));
}

/** Kesenin yolda geçireceği gerçek süre; hızlı channel'da yol da kısalır. */
export const agitationTravelMs = (channelSpeed: number) =>
  Math.max(15_000, Math.round(AGITATION.travelMinutes * 60_000 / Math.max(1, channelSpeed || 1)));

/**
 * Çift bekleme penceresinin indeksi; veritabanındaki UNIQUE index bunu kullanır.
 *
 * Bu, beklemenin YARIŞA KARŞI katmanıdır: aynı çifte aynı pencerede iki
 * eşzamanlı istek yazılamaz. Sürenin kendisi (son keseden bu yana 6 oyun saati)
 * uygulama katmanında ölçülür, çünkü sabit ızgara pencere sınırının iki yanına
 * düşen iki keseye sıfır aralık tanıyabilir. İkisi birlikte hem süreyi hem
 * yarışı kapatır.
 */
export const agitationPairWindow = (at: number, channelSpeed: number) =>
  Math.floor(at / (AGITATION.pairWaitHours * 3_600_000 / Math.max(1, channelSpeed || 1)));

/** Oyun-günü penceresinin başlangıcı; tavan sayımları buradan sayılır. */
export const agitationDayStart = (at: number, channelSpeed: number) =>
  at - 86_400_000 / Math.max(1, channelSpeed || 1);

type AgitationCarrier = Pick<Game, "agitationPressure" | "agitationBribe" | "agitationAt" | "agitationShieldUntil" | "speed">;

type GlutCarrier = Pick<Game, "commonsGlut" | "commonsGlutAt" | "agitationShieldUntil" | "speed">;

const gameHours = (from: number, to: number, speed: number) =>
  Math.max(0, (to - from) / 3_600_000 * Math.max(1, speed || 1));

/** Kalkan hâlâ ayakta mı? Kalkan hem sönümü hızlandırır hem yeni keseyi yarılar. */
export const agitationShielded = (game: Pick<Game, "agitationShieldUntil">, now: number) =>
  (game.agitationShieldUntil ?? 0) > now;

/**
 * Kesenin ŞU ANDAKİ etkisi. Depolanan değer damga anındaki değerdir; buradaki
 * kapalı çözüm onu bugüne taşır. Saf ve adım-bağımsız: e^(-h/τ) tam
 * bölünebilir olduğu için istemcinin küçük adımları ile sunucunun tek adımı
 * aynı sayıyı verir.
 */
export function agitationEffect(game: AgitationCarrier, now: number) {
  const at = game.agitationAt ?? 0;
  const shielded = agitationShielded(game, now);
  const tau = shielded ? AGITATION.shieldedTau : AGITATION.tau;
  const decay = at > 0 ? Math.exp(-gameHours(at, now, game.speed) / tau) : 0;
  return {
    /** Muhalefet baskısına eklenen puan. */
    pressure: Math.max(0, Math.min(AGITATION.commons.cap, (game.agitationPressure ?? 0) * decay)),
    /** Asker huzursuzluğuna eklenen puan. */
    bribe: Math.max(0, Math.min(AGITATION.garrison.cap, (game.agitationBribe ?? 0) * decay)),
    shielded,
  };
}

/**
 * Asker huzursuzluğunun HİSSEDİLEN değeri: kaydın kendi huzursuzluğu artı
 * yabancının kesesi. Kesenin payı `soldierUnrest` alanının İÇİNE yazılmaz —
 * yazılsaydı maaş ödense bile kalıcı olur ve sönüm anlamını yitirirdi.
 *
 * Kesenin bu kanaldan yürüdüğü yerler: zapt gücü (`suppression`), garnizon
 * vetosu, firar/isyan eşikleri ve panel. Sur savunmasına (`defenseOf`)
 * KARIŞMAZ: kese homurdanma satın alır, ihanet satın almaz — huzursuz asker
 * halkı zapt etmez ama kurt geldiğinde canı pahasına yine dövüşür.
 */
export function feltUnrest(game: AgitationCarrier & Pick<Game, "soldierUnrest">, now: number) {
  return Math.max(0, Math.min(100, (game.soldierUnrest ?? 0) + agitationEffect(game, now).bribe));
}

/**
 * Yeni bir kesenin hedefin kaydına yazacağı değerler.
 *
 * `at` kesenin VARDIĞI andır (`completesAt`), cron'un çalıştığı an değil: etki
 * geriye dönük damgalanır, böylece cron bir tur gecikse de sonuç değişmez.
 * Mevcut birikim önce o ana kadar sönümlenir, sonra yeni pay eklenir ve tavan
 * uygulanır.
 */
export function applyAgitation(
  game: AgitationCarrier,
  kind: AgitationKind,
  at: number,
): { agitationPressure: number; agitationBribe: number; agitationAt: number } {
  const decayed = agitationEffect(game, at);
  const share = decayed.shielded ? AGITATION.shieldedShare : 1;
  const pressure = kind === "gold_commons"
    ? Math.min(AGITATION.commons.cap, decayed.pressure + AGITATION.commons.perPurse * share)
    : decayed.pressure;
  const bribe = kind === "gold_garrison"
    ? Math.min(AGITATION.garrison.cap, decayed.bribe + AGITATION.garrison.perPurse * share)
    : decayed.bribe;
  return { agitationPressure: pressure, agitationBribe: bribe, agitationAt: at };
}

/**
 * Yığının ŞU ANDAKİ payı, mal başına ve referans stoğun katı olarak.
 * Altın kesesiyle aynı damga tabanlı kapalı çözüm; kalkan sönümü hızlandırır.
 */
export function glutShare(game: GlutCarrier, now: number): Record<TradeKey, number> {
  const at = game.commonsGlutAt ?? 0;
  const tau = agitationShielded(game, now) ? AGITATION.shieldedTau : AGITATION.tau;
  const decay = at > 0 ? Math.exp(-gameHours(at, now, game.speed) / tau) : 0;
  const stored = game.commonsGlut ?? {};
  return Object.fromEntries(TRADED_KEYS.map(key => {
    const value = Number(stored[key]) || 0;
    return [key, Math.max(0, Math.min(GLUT.cap, value * decay))];
  })) as Record<TradeKey, number>;
}

/**
 * Yığının FİYATLANDIRMADA kullanılacak mutlak miktarı. Referansla çarpılır ki
 * nüfus büyüyünce aynı yığın daha az bozsun: küçük bir köyü şişirmek kolaydır.
 */
export function glutStock(game: GlutCarrier, reference: Record<TradeKey, number>, now: number): Record<TradeKey, number> {
  const share = glutShare(game, now);
  return Object.fromEntries(TRADED_KEYS.map(key => [key, share[key] * (reference[key] ?? 0)])) as Record<TradeKey, number>;
}

/**
 * Yeni bir mal kesesinin hedefin kaydına yazacağı yığın. Altın kesesiyle aynı
 * geriye dönük damgalama: `at` malın VARDIĞI andır.
 *
 * Mal kesesi muhalefet baskısı ÜRETMEZ ve rızaya dokunmaz — üretseydi iki kese
 * birbirini götürürdü, çünkü bol mal halkı memnun eder.
 */
export function applyGlut(
  game: GlutCarrier,
  key: TradeKey,
  at: number,
): { commonsGlut: Partial<Record<TradeKey, number>>; commonsGlutAt: number } {
  const decayed = glutShare(game, at);
  const share = agitationShielded(game, at) ? AGITATION.shieldedShare : 1;
  const next: Partial<Record<TradeKey, number>> = {};
  for (const traded of TRADED_KEYS) {
    const value = traded === key
      ? Math.min(GLUT.cap, decayed[traded] + GLUT.perPurse * share)
      : decayed[traded];
    if (value > 0) next[traded] = value;
  }
  return { commonsGlut: next, commonsGlutAt: at };
}

// --- HAYDUT YÖNLENDİRME ----------------------------------------------------

/**
 * Kral, dağ yollarındaki eşkıyayı komşusunun kalesine doğru çeker.
 *
 * Yönlendirme akının ŞİDDETİNE DOKUNMAZ — dokunsaydı "asıl karar nöbet
 * oranındadır" ilkesi bozulurdu. Yalnızca SIKLIĞI ve haydut türünün ağırlığını
 * bir süre kaydırır (bkz. engine/raids.ts → raidInWindow).
 *
 * Zar hedefin kendi tohumunda kalır; yönlendirme yalnızca eşiği kaydırır. Bunun
 * belirleyici teknik ayrıntısı şudur: yönlendirme akının çözüldüğü ana DEĞİL,
 * PENCERENİN BAŞLANGICINA göre okunur. Aksi hâlde `resolveRaids`'in iki kez
 * çağrılması (istemcinin tick'i ve sunucunun `checkAgainstSimulation`'ı) aynı
 * pencerede iki farklı akın üretirdi.
 *
 * Ölçülen etki (ova, Sur yok, Kale Sv.3): 24 saatte beklenen akın sayısı
 * 0,94'ten 1,60'a çıkar. Asıl stratejik değeri yağma değil, hedefi nöbet
 * oranını yükseltmeye zorlaması: nöbet yükseldikçe `suppression` zayıflar, yani
 * bu mekanik iç muhalefet ve asker kesesiyle SİNERJİKTİR.
 */
export const LURE = {
  /** Tek yönlendirmenin akın ihtimaline çarpan olarak eklediği pay. */
  perPurse: .7,
  /** Hedefte en fazla iki etkin yönlendirme birikir; fazlası kırpılır. */
  cap: 1.4,
  /** Haydut ağırlığının kaymasının tavanı: yönlendirilen eşkıya yol keser. */
  banditShift: .5,
} as const;

type LureCarrier = Pick<Game, "raidLure" | "raidLureAt" | "agitationShieldUntil" | "speed">;

/**
 * Yönlendirmenin `at` ANINDAKİ payı. Saf ve damga tabanlı: aynı pencere için
 * kaç kez sorulursa sorulsun aynı sayıyı verir.
 */
export function lureAt(game: LureCarrier, at: number) {
  const stamp = game.raidLureAt ?? 0;
  if (!(stamp > 0)) return 0;
  const tau = agitationShielded(game, at) ? AGITATION.shieldedTau : AGITATION.tau;
  const decay = Math.exp(-gameHours(stamp, at, game.speed) / tau);
  return Math.max(0, Math.min(LURE.cap, (game.raidLure ?? 0) * decay));
}

/** Yeni bir yönlendirmenin hedefin kaydına yazacağı değerler. */
export function applyLure(game: LureCarrier, at: number): { raidLure: number; raidLureAt: number } {
  const share = agitationShielded(game, at) ? AGITATION.shieldedShare : 1;
  return {
    raidLure: Math.min(LURE.cap, lureAt(game, at) + LURE.perPurse * share),
    raidLureAt: at,
  };
}

/**
 * İFŞA, iki kademeli ve zarsız.
 *
 * 1. kademe (her zaman): "bir şey oldu", kimlik yok.
 * 2. kademe (hedefin karşı-istihbaratı kesenin VARDIĞI anda ayaktaysa):
 *    gönderenin adı, itibar cezası ve hedefe kalkan.
 */
export const AGITATION_NOTICE: Record<AgitationKind, string> = {
  gold_commons: "Halkın arasında yabancı bir el sezildi; kim olduğu belli değil. Kahvelerde dağıtılan paranın izi bulunamadı.",
  gold_garrison: "Kışlada yabancı bir kese dolaştığı duyuldu; kimin gönderdiği belli değil.",
  goods_glut: "Pazarda tuhaf bir bolluk var: kimsenin bilmediği kervanlar tezgâhları doldurdu, satış fiyatları düştü. Malın nereden geldiği anlaşılamadı.",
  raid_lure: "Dağ yollarında tuhaf bir hareket var: eşkıya sanki kaleye doğru çekilmiş. Kimin çektiği belli değil.",
};

const WHERE: Record<AgitationKind, string> = {
  gold_commons: "halkımızın arasına para dağıtıyordu",
  gold_garrison: "kışlamıza para sokuyordu",
  goods_glut: "pazarımızı bozmak için kervanla mal yığıyordu",
  raid_lure: "dağ eşkıyasını kalemize doğru çekiyordu",
};

export const agitationExposedNotice = (kingdom: string, kind: AgitationKind) =>
  `Karşı-istihbarat nöbeti eli yakaladı: ${kingdom} ${WHERE[kind]}. Yakalanan hat bir süre daha kapalı kalacak.`;

const SENT_TO: Record<AgitationKind, string> = {
  gold_commons: "halkının arasına",
  gold_garrison: "kışlasına",
  goods_glut: "pazarına",
  raid_lure: "yollarına",
};

/** Gönderene yazılan satır; hedefin adı gönderen zaten bildiği için verilir. */
export const agitationSenderNotice = (target: string, kind: AgitationKind, exposed: boolean) =>
  exposed
    ? `${target} kesemizi yakaladı; kimliğimiz açığa çıktı ve itibarımız zedelendi.`
    : `Kese ${target} ${SENT_TO[kind]} sessizce ulaştı.`;
