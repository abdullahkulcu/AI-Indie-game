import { materialScaleOf } from "./catalog";
import type { Game, Key, Res } from "./types";

/**
 * Depo kapasitesi.
 *
 * Bakım gideri birikimin HIZINI yavaşlatır; tavanı ise depo koyar. İkisi
 * olmadan ambar sonsuza kadar büyüyor ve kaynak anlamsızlaşıyordu.
 *
 * İki ayrı yapı:
 *  - Ambar   → yiyecek ve bira (bozulur)
 *  - Depo    → odun ve taş (çürür, çalınır)
 *
 * Altın ve demirin tavanı YOKTUR. Hazine çürümez ve tavan konursa Kral büyük
 * bir inşaat için biriktiremez; demir zaten kıt, onu ayrıca cezalandırmak
 * anlamsız. Tavan yalnızca gerçekten taşan kaynaklara konur.
 *
 * Aşan kısım ANINDA silinmez, saatte bir oranla bozulur. Böylece Kralın depo
 * kurmaya ya da Pazarda satmaya vakti olur; ambar bir anda boşalmaz.
 */

/** Depo yokken bile bir miktar stok tutulur; kale mahzeni. */
const BASE = { food: 1_500, ale: 900, wood: 1_500, stone: 1_500 } as const;

/** Yapı seviyesi başına eklenen kapasite. */
const PER_LEVEL = { food: 2_600, ale: 1_100, wood: 2_200, stone: 2_200 } as const;

/**
 * Tavanı aşan stoğun saatlik kaybı, KAPASİTENİN oranı olarak.
 *
 * Oran fazlalığın kendisine uygulansaydı (üstel erime) motor determinizmini
 * kaybederdi: küçük adımlarla ilerleyen istemci ile tek adımda ilerleyen
 * sunucu farklı sonuca varırdı.
 *
 * Sabit oran TEK BAŞINA yetmiyordu ve buradaki eski yorum bunun tersini iddia
 * ediyordu. Kayıp yalnızca stok tavanın ÜSTÜNDEYKEN işler; stok aralığın
 * ortasında tavanın altına inerse "ne kadar süre üstte kaldığı" adım boyuna
 * bağlı hale gelir. Ölçülen sapma (tavan 1000, stok 1200, net −100/saat, 5 saat):
 *   tek adım 700 · saatlik adım 600 · saniyelik adım 566,7  → %19
 * Çözüm aşağıda: bozulma artık aralığın SONUNDAKİ stoğa değil, aralık boyunca
 * stoğun izlediği YOLA bakıyor ve kesin çözümü kapalı formülle veriyor.
 */
export const SPOIL_RATE = .2;

export function levelOf(game: Pick<Game, "buildings">, type: string) {
  return game.buildings.find(building => building.type === type)?.level ?? 0;
}

/** Her kaynağın tavanı. 0 dönen kaynakta tavan yoktur. */
export function storageCaps(game: Pick<Game, "buildings" | "speed">): Res {
  const granary = levelOf(game, "granary");
  const warehouse = levelOf(game, "warehouse");
  // Tavan, maliyetle AYNI channel çarpanını kullanır. Kullanmazsa oyun kilitlenir:
  // yükseltmenin bedeli tavanın üstünde kalır ve hiçbir zaman biriktirilemez.
  const scale = materialScaleOf(game.speed);
  return {
    food: (BASE.food + granary * PER_LEVEL.food) * scale,
    ale: (BASE.ale + granary * PER_LEVEL.ale) * scale,
    wood: (BASE.wood + warehouse * PER_LEVEL.wood) * scale,
    stone: (BASE.stone + warehouse * PER_LEVEL.stone) * scale,
    // 0 = tavan yok.
    gold: 0,
    iron: 0,
  };
}

export type Spoilage = { resources: Res; lost: Partial<Record<Key, number>> };

/**
 * Bir kaynağın bozulma kaybı, aralığın KESİN çözümüyle.
 *
 * Aralık boyunca stok şu denklemi izler (üretim/tüketim aralıkta sabit hızda
 * kabul edilir; motor zaten öyle hesaplıyor):
 *
 *     ds/dt = rate − D · [s > cap]      D = cap · SPOIL_RATE
 *
 * Bu otonom denklemin akışı bir yarı-gruptur: f(a+b) = f(b) ∘ f(a). Yani
 * aralığı ikiye, altmışa ya da 18.000 saniyelik adıma bölmek AYNI sonucu verir
 * — motorun determinizm kuralının istediği tam olarak budur. Eski hesap
 * yalnızca aralık sonundaki stoğa bakıyordu ve stok tavanın altına indiği anda
 * sapıyordu.
 *
 * Üç faz vardır: tavanın üstünde erime, tavanın altında serbest hareket ve
 * ikisinin arasında tavana yapışma (üretim kayıptan küçükse fazlalık üretildiği
 * anda bozulur, stok tavanda kalır).
 */
function spoiledOver(start: number, rate: number, cap: number, hours: number): number {
  const decay = cap * SPOIL_RATE;
  let lost = 0, elapsed = 0, level = start;

  if (level > cap) {
    const slope = rate - decay;
    // Tavanın üstündeyken erime; net eğim yukarıysa aralık boyunca üstte kalır.
    const reach = slope >= 0 ? Infinity : (level - cap) / -slope;
    if (reach >= hours) return decay * hours;
    lost = decay * reach; elapsed = reach; level = cap;
  } else if (rate > 0) {
    // Tavanın altındayken bozulma yok; tavana ne zaman değdiğini buluruz.
    const reach = (cap - level) / rate;
    if (reach >= hours) return 0;
    elapsed = reach; level = cap;
  } else {
    return 0;
  }

  // Tavana değdik. Kalan süre üç şıktan biriyle geçer.
  const rest = hours - elapsed;
  if (rate <= 0) return lost;                       // stok tavanın altına iniyor
  if (rate >= decay) return lost + decay * rest;    // üretim erimeyi aşıyor, stok yine yükseliyor
  return lost + rate * rest;                        // tavana yapıştı: üretilen kadarı bozuluyor
}

/**
 * Tavanı aşan stoğu bozar. Anında kırpmaz: fazlalık SPOIL_RATE ile erir, yani
 * Kralın depo kurmaya ya da Pazarda satmaya vakti olur.
 *
 * `resources` aralığın SONUNDAKİ (üretim/tüketim uygulanmış) stok, `previous`
 * ise BAŞINDAKİ stoktur. İkisi birden gerekir: bozulmanın ne kadar sürdüğü
 * stoğun aralık boyunca izlediği yola bağlıdır, yalnızca varış noktasına değil.
 * Verilmezse aralıkta hiç üretim olmadığı varsayılır (eski davranış).
 */
export function applySpoilage(resources: Res, caps: Res, hours: number, previous: Res = resources): Spoilage {
  if (hours <= 0) return { resources, lost: {} };
  const next = { ...resources };
  const lost: Partial<Record<Key, number>> = {};

  for (const key of Object.keys(next) as Key[]) {
    const cap = caps[key];
    if (!(cap > 0)) continue; // 0 = tavan yok (altın, demir)
    const start = previous[key];
    const rate = (next[key] - start) / hours;
    const gone = spoiledOver(start, rate, cap, hours);
    if (!(gone > 0)) continue;
    lost[key] = gone;
    next[key] = Math.max(0, next[key] - gone);
  }
  return { resources: next, lost };
}

/** Doluluk oranı; arayüzde ambarın taşmak üzere olduğunu göstermek için. */
export function fillRatio(resources: Res, caps: Res, key: Key) {
  const cap = caps[key];
  return cap > 0 ? resources[key] / cap : 0;
}
