import type { Game } from "./types";

/**
 * DIŞ KESE — komşu krallığın halkına ya da askerine gönderilen para.
 *
 * Kral 600 altın karşılığında bir kese yollar; kese hedefin HALKINA giderse
 * oradaki hoşnutsuzluğu örgütler (hizip baskısı), ASKERİNE giderse doğrudan
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

export type AgitationKind = "gold_commons" | "gold_garrison";

export const AGITATION = {
  /** Sabit fiyat. Serbest miktar yok: 600, doğrulayıcının 250 altınlık
   *  toleransının (SIMULATION_FLOOR) 2,4 katı — keseye saklanamaz. */
  cost: 600,
  /** Kesenin yola çıkışından etkisine kadar geçen OYUN dakikası. */
  travelMinutes: 45,
  /**
   * Halka giden kese: hizip baskısına eklenen puan. Tavan 11,5 — şenliğin
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
    /** Hizip baskısına eklenen puan. */
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
 * İFŞA, iki kademeli ve zarsız.
 *
 * 1. kademe (her zaman): "bir şey oldu", kimlik yok.
 * 2. kademe (hedefin karşı-istihbaratı kesenin VARDIĞI anda ayaktaysa):
 *    gönderenin adı, itibar cezası ve hedefe kalkan.
 */
export const AGITATION_NOTICE = {
  commons: "Halkın arasında yabancı bir el sezildi; kim olduğu belli değil. Kahvelerde dağıtılan paranın izi bulunamadı.",
  garrison: "Kışlada yabancı bir kese dolaştığı duyuldu; kimin gönderdiği belli değil.",
} as const;

export const agitationExposedNotice = (kingdom: string, kind: AgitationKind) =>
  kind === "gold_commons"
    ? `Karşı-istihbarat nöbeti keseyi yakaladı: ${kingdom} halkımızın arasına para dağıtıyordu. Yakalanan hat bir süre daha kapalı kalacak.`
    : `Karşı-istihbarat nöbeti keseyi yakaladı: ${kingdom} kışlamıza para sokuyordu. Yakalanan hat bir süre daha kapalı kalacak.`;

/** Gönderene yazılan satır; hedefin adı gönderen zaten bildiği için verilir. */
export const agitationSenderNotice = (target: string, kind: AgitationKind, exposed: boolean) =>
  exposed
    ? `${target} kesemizi yakaladı; kimliğimiz açığa çıktı ve itibarımız zedelendi.`
    : `Kese ${target} ${kind === "gold_commons" ? "halkının arasına" : "kışlasına"} sessizce ulaştı.`;
