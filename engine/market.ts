import { NEED } from "./populace";
import type { Commons, Game, TradeKey } from "./types";

/**
 * YEREL PAZAR — Kralın kendi halkıyla ticareti.
 *
 * Bu pazar soyut bir NPC tezgâhı değildir. Karşı taraf halkın kendisidir ve
 * krallıkta İKİ DEFTER vardır:
 *   1) `resources` — kale ambarı, Kralın malı.
 *   2) `commons`   — halkın kendi stoğu (bu dosya).
 *
 * Fiyat bu ikinci defterden doğar: halkın elindeki miktar kendi ihtiyacına
 * göre azaldıkça mal pahalanır, bollaştıkça ucuzlar. Dolayısıyla
 *   · Kral satarsa → halkın stoğu artar → fiyat düşer,
 *   · Kral alırsa  → halkın stoğu azalır → fiyat yükselir,
 *   · istihkakı açarsa (kaleden halka aktarım) → ekmek ucuzlar,
 *   · istihkakı kısarsa → ekmek pahalanır.
 * Kıtlık artık bir dünya olayı değil, Kralın verebileceği bir karardır.
 *
 * Halk bu pazarda bir muhatap değildir: sözleşme yapmaz, pazarlık etmez,
 * emir almaz. Yalnızca elindekine göre fiyat verir. Kralın halkla konuşması
 * ayrı bir iştir; burada olan bitenin tamamı iktisattır.
 *
 * Channel çapındaki oyuncular arası pazar AYRI bir iştir; orada fiyatı
 * oyuncular belirler. Bu dosya yalnızca krallık içini ilgilendirir.
 */

export type { Commons, TradeKey } from "./types";

export const TRADED_KEYS: TradeKey[] = ["food", "wood", "stone", "iron", "ale"];

export const isTraded = (key: string): key is TradeKey =>
  (TRADED_KEYS as string[]).includes(key);

const build = (value: (key: TradeKey) => number): Commons =>
  Object.fromEntries(TRADED_KEYS.map(key => [key, value(key)])) as Commons;

/**
 * Halkın "normal" stoğu kaç saatlik ihtiyaca denk düşer.
 *
 * Yiyecek ve birada bu doğrudan NEED ile çarpılır: iki günlük kiler. Odun, taş
 * ve demirin saatlik bir ihtiyacı olmadığı için kişi başı sabit bir miktar
 * verilir — evin odunluğu, tamir taşı, aletin demiri.
 */
export const LARDER_HOURS = 48;

/** Kişi başı normal stok. Referans stok = nüfus × bu sayı. */
export const PER_CAPITA: Commons = {
  food: NEED.food * LARDER_HOURS,
  ale: NEED.ale * LARDER_HOURS,
  wood: 4,
  stone: 2.5,
  iron: .4,
};

/** Halkın stoğu tam normalindeyken (kapsama = 1) geçerli birim fiyat. */
export const BASE_PRICE: Commons = { food: .25, wood: .3, stone: .4, iron: 1.2, ale: .8 };

/** Alışın satıştan pahalı olması: tezgâhtarın payı. Tur atmak hep zarardır. */
export const SPREAD = 1.6;

/**
 * Fiyat eğrisi: kapsama (halkın stoğu ÷ referans stok) arttıkça fiyat düşer.
 *
 * İki taraflı doğru parçası, kırılma noktası kapsama = 1'de. KITLIK TARAFI
 * DAHA DİKTİR (1.6'ya karşı .55): halkın elinden malı çekmek, ona mal
 * yığmaktan daha sert bir fiyat hareketi yaratır. Aç bir köy pahalı satar;
 * dolu bir köy ucuza alır ama tavan fiyatı sıfıra indirmez.
 *
 * Tavan kendiliğinden 1 + SCARCITY_UP'tır (stok tamamen bittiğinde), taban ise
 * elde tutulur: bedavaya yakın bir fiyat, "çöp kutusu" pazarı geri getirirdi.
 * Taban DÜZ olduğu için çok büyük dökümlerin kuyruğu sıfıra değil, taban
 * fiyata oturur — yani ambar boşaltmak zarar ettirir ama malı yok etmez.
 */
export const SCARCITY_UP = 1.6;
export const GLUT_DOWN = .55;
export const PRICE_FLOOR = .3;
export const PRICE_CEILING = 1 + SCARCITY_UP;

/**
 * Ortalamaya dönüş hızı (1/saat). Halkın kendi ekonomisi: eksikse toplar,
 * fazlaysa harcar/çürütür. Yarılanma ömrü ln2 / MEND ≈ 15 oyun saati.
 *
 * Bu aynı zamanda "üretimin bir kısmı halkta kalır" kuralının kendisidir:
 * odun, taş ve demirin istihkakı yoktur, halk onları kendi toplar. MEND o
 * toplamanın hızıdır. Kralın oradaki tek kaldıracı ticarettir.
 *
 * NEDEN ÜSTEL, ve neden bu sefer determinizmi bozmuyor:
 * `engine/storage.ts` içindeki bozulma üstel yazıldığında determinizm kırıldı,
 * çünkü orada erimenin DIŞINDA bir kaynak vardı (üretim her adımda araya
 * giriyordu) ve üstelin kapalı çözümü o kaynağı içermiyordu. Burada akışın
 * TAMAMI kapalı çözümün içindedir:
 *
 *     dx/dt = -MEND · (x - ref) + flow      (flow pencere boyunca sabit)
 *     x(h)  = denge + (x0 - denge) · e^(-MEND·h),   denge = ref + flow/MEND
 *
 * Üstel fonksiyonun kendisi tam olarak bölünebilirdir: e^(-k·6) = (e^(-k))^6.
 * Yani istemcinin altı adımı sunucunun tek adımıyla birebir aynı sonucu verir
 * (bkz. tests/market.test.ts). Doğrusal-kırpmalı bir çekim ise stok referansı
 * geçerken adım boyutuna göre SAPARDI; üstel biçim burada daha güvenlidir.
 */
export const MEND = .045;

/** Halk son lokmasını satmaz: tek emirde stoğunun en çok bu oranı alınabilir. */
export const MAX_DRAW = .6;

/** Bir emir bu büyüklükte parçalar hâlinde doldurulur; fiyat her parçada yeniden okunur. */
const LOT = 10;

/** Nüfusun taşıyabileceği normal stok. Halk büyüdükçe pazarın derinliği de büyür. */
export function commonsReference(population: number): Commons {
  const people = Math.max(1, Number(population) || 0);
  return build(key => people * PER_CAPITA[key]);
}

/**
 * Halkın defteri. Eski kayıtlarda alan yoktur; o zaman halk normal stoğunda
 * kabul edilir (kapsama = 1, fiyat = taban fiyat), yani kimsenin kaydı bozulmaz
 * ve kimse bedava bir fiyat şokuyla karşılaşmaz.
 */
export function commonsOf(game: Pick<Game, "population" | "commons">): Commons {
  const reference = commonsReference(game.population);
  const stored = game.commons;
  return build(key => {
    const value = stored?.[key];
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : reference[key];
  });
}

/** Halkın stoğunun ihtiyacına oranı. 1 = normal, 0 = kıtlık, 2 = bolluk. */
export const coverageOf = (stock: number, reference: number) =>
  reference > 0 ? Math.max(0, stock) / reference : 1;

/** Kapsamadan fiyat çarpanı. 1 = taban fiyat. */
export function priceMultiplier(coverage: number) {
  const value = Math.max(0, coverage);
  const raw = value <= 1 ? 1 + SCARCITY_UP * (1 - value) : 1 - GLUT_DOWN * (value - 1);
  return Math.max(PRICE_FLOOR, Math.min(PRICE_CEILING, raw));
}

/** Anlık birim satış fiyatı (Kral satarsa alacağı). Alışta ayrıca SPREAD uygulanır. */
export function unitPrice(key: TradeKey, stock: number, reference: number) {
  return BASE_PRICE[key] * priceMultiplier(coverageOf(stock, reference));
}

/**
 * FİYATLANDIRMA STOĞU ile TİCARET STOĞUNUN AYRIMI.
 *
 * `tradableStock` halkın gerçekten sahip olduğu maldır: alışta bundan alınır,
 * `maxPurchase` bunu ölçer, geçim endeksi (`livingCost`) bunu okur.
 *
 * `pricingStock` ise fiyatın okunduğu yığındır ve YALNIZCA SATIŞTA devreye
 * girer: yabancı bir Kralın hedefin pazarına yığdığı mal (`commonsGlut`)
 * buraya eklenir. Ayrım bilinçlidir ve iki ters etkiyi kapatır — hedef
 * şişirilen malı ucuza satın alıp ambarına koyamaz, ve şişen yığın hedefin
 * rızasını YÜKSELTMEZ. Fiyat kanalı açık, kaçak kanallar kapalı.
 */
export const tradableStock = (commons: number) => Math.max(0, commons);

export const pricingStock = (commons: number, glut = 0) =>
  Math.max(0, commons) + Math.max(0, glut);

export const pricingCoverage = (commons: number, reference: number, glut = 0) =>
  coverageOf(pricingStock(commons, glut), reference);

/**
 * Bütün malların anlık satış fiyatı. `marketState` bunu arayüze verir; eski
 * sabit tablonun yerini birebir aynı biçimde alır.
 *
 * `glut` verilirse SATIŞ fiyatı düşer — bu, arayüzün de bozulmuş pazarı
 * göstermesini sağlar; Kral neden az altın aldığını görmeden yönetemez.
 */
export function marketPrices(commons: Commons, reference: Commons, glut?: Partial<Record<TradeKey, number>>): Record<string, number> {
  return Object.fromEntries(TRADED_KEYS.map(key =>
    [key, unitPrice(key, pricingStock(commons[key], glut?.[key] ?? 0), reference[key])]));
}

/** Halktan bir seferde alınabilecek en büyük miktar. */
export const maxPurchase = (stock: number) => Math.floor(Math.max(0, stock) * MAX_DRAW);

export type Fill = {
  /** Emrin toplam bedeli: satışta hazineye girecek, alışta hazineden çıkacak altın. */
  gold: number;
  /** Emir kapandıktan sonra halkın elinde kalan miktar. */
  commons: number;
  /** Fiilen gerçekleşen ortalama birim fiyat. */
  average: number;
  /** Emir öncesi ve sonrası birim fiyat; Krala kayma (slippage) böyle gösterilir. */
  from: number;
  to: number;
};

/**
 * Bir emri doldurur ve FİYATI EMRİN İÇİNDE HAREKET ETTİRİR.
 *
 * Bu maddenin kendisi bir istismar kapatır: fiyat yalnızca emirler arasında
 * güncellenseydi Kral 5.000 odunu işlem öncesi fiyattan satar, ancak ondan
 * sonra fiyat düşerdi. Emir LOT büyüklüğünde parçalara bölünür, her parça o
 * andaki stoğa göre fiyatlanır ve stok parça parça hareket eder. Sonuç:
 * büyük emrin ortalaması küçük emrinkinden satışta düşük, alışta yüksektir.
 *
 * Her parça kendi ORTA NOKTASINDAN fiyatlanır. Orta nokta kuralı doğrusal bir
 * eğride parça boyutundan bağımsız olarak KESİN sonucu verir; eğri yalnızca
 * kapsama = 1 kırılmasında ve taban/tavana çarptığı yerde doğrusallıktan
 * çıkar, orada da LOT kadar küçük bir pay kalır.
 */
export function fillOrder(
  key: TradeKey,
  amount: number,
  stock: number,
  reference: number,
  direction: "sell" | "buy",
  /**
   * Yabancının pazara yığdığı mal. YALNIZCA satış kolunda fiyata girer; alışta
   * hiç okunmaz, yoksa hedef bedavaya yakın fiyattan mal alıp ambarına koyardı.
   */
  glut = 0,
): Fill {
  const total = Math.max(0, Math.floor(amount));
  // Fiyat penceresi satışta yığını da içerir; hareket eden stok her zaman
  // halkın gerçek malıdır.
  const offset = direction === "sell" ? Math.max(0, glut) : 0;
  const from = unitPrice(key, stock + offset, reference);
  let held = Math.max(0, stock), gold = 0, left = total;

  while (left > 0) {
    const lot = Math.min(LOT, left);
    const middle = direction === "sell" ? held + offset + lot / 2 : Math.max(0, held - lot / 2);
    gold += lot * unitPrice(key, middle, reference) * (direction === "buy" ? SPREAD : 1);
    held = direction === "sell" ? held + lot : Math.max(0, held - lot);
    left -= lot;
  }

  // Satışta aşağı, alışta yukarı yuvarlanır: küsurat hep halkın lehinedir.
  const settled = direction === "sell" ? Math.floor(gold) : Math.ceil(gold);
  return {
    gold: settled,
    commons: held,
    // Ortalama, Kralın fiilen eline geçen altından okunur; arayüzde gösterilen
    // sayı ile hazineye giren sayı birbirini tutsun.
    average: total > 0 ? settled / total : from,
    from,
    to: unitPrice(key, held + offset, reference),
  };
}

/**
 * Kaleden halka (ve halktan ağza) akış: bir saatlik net değişim.
 *
 * İstihkak vermek KALEDEN HALKA AKTARIMDIR — kale ambarı bunu zaten
 * `hourlyDemand` ile ödüyor, karşılığı şimdiye kadar hiçbir deftere
 * girmiyordu. Halk aldığını yer; %100 istihkakta akış sıfırdır, %200'de kiler
 * şişer ve ekmek ucuzlar, %0'da kiler boşalır ve ekmek pahalanır.
 *
 * `served` kâğıt üstündeki oran değil, ambarın FİİLEN dağıtabildiği orandır;
 * yani boş bir ambarla yüksek istihkak ilan etmek ekmeği ucuzlatmaz.
 *
 * Odun, taş ve demirin istihkakı yoktur; onların akışı yalnızca ortalamaya
 * dönüştür (bkz. MEND).
 */
export function commonsFlow(population: number, served: { food: number; ale: number }) {
  const people = Math.max(0, Number(population) || 0);
  return {
    food: people * NEED.food * (served.food / 100 - 1),
    ale: people * NEED.ale * (served.ale / 100 - 1),
  } as Partial<Record<TradeKey, number>>;
}

/**
 * Halkın defterini `hours` kadar ilerletir: sabit akış + ortalamaya dönüş.
 * Kapalı çözüm kullanıldığı için adımlara bölününce birebir aynı sonucu verir.
 */
export function advanceCommons(
  stock: Commons,
  reference: Commons,
  flow: Partial<Record<TradeKey, number>>,
  hours: number,
): Commons {
  if (!(hours > 0)) return build(key => stock[key]);
  const decay = Math.exp(-MEND * hours);
  return build(key => {
    // Denge noktası: akış sabitken stoğun yürüdüğü yer. flow = 0 iken referanstır.
    const balance = reference[key] + (flow[key] ?? 0) / MEND;
    // Denge her zaman ≥ 0 olduğu için (en kötü hâlde istihkak %0: referansın
    // yarısından fazlası kalır) bu kırpma fiilen hiç devreye girmez; girseydi
    // adım bölünebilirliğini bozardı, bu yüzden yalnızca emniyet supabıdır.
    return Math.max(0, balance + (stock[key] - balance) * decay);
  });
}

/**
 * GEÇİM ENDEKSİ — halkın sofrasının kaça mal olduğu. 1 = normal.
 *
 * Yalnızca yiyecek ve bira sayılır: taşın fiyatı kimsenin karnını ilgilendirmez.
 * Ekmek ağır basar (0.7'ye 0.3), çünkü bira lüks, ekmek zorunludur.
 */
export const LIVING_WEIGHTS = { food: .7, ale: .3 } as const;

export function livingCost(commons: Commons, reference: Commons) {
  return LIVING_WEIGHTS.food * priceMultiplier(coverageOf(commons.food, reference.food))
    + LIVING_WEIGHTS.ale * priceMultiplier(coverageOf(commons.ale, reference.ale));
}

/**
 * Geçim endeksinin RIZAYA bedeli (puan). `moodTarget`'a eklenir.
 *
 * ASİMETRİKTİR: pahalılık, ucuzluğun neredeyse iki katı ağırlıkta (11'e 6).
 * Ucuz ekmek halkın hakkı sayılır, pahalı ekmek hakaret. Bu asimetri olmadan
 * Kral fiyatı bir gün kırıp bir gün fırlatarak rızayı bedavaya sabit tutardı.
 *
 * Ölçek: yalnız istihkakla oynayarak endeks 0.75–1.74 arasında gezer, yani
 * ±(4.5 … 8) puan. Kral halkın kilerini pazardan süpürürse endeks 2.6'ya
 * çıkar ve bedel ‑17 puana kadar tırmanır — kıtlık yaratmak mümkündür ama
 * ucuz değildir.
 */
export const LIVING_MOOD = { relief: 6, strain: 11 } as const;

export function livingCostMood(index: number) {
  const drift = (Number.isFinite(index) ? index : 1) - 1;
  return drift <= 0 ? -drift * LIVING_MOOD.relief : -drift * LIVING_MOOD.strain;
}
