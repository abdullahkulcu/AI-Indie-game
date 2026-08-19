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
 * sunucu farklı sonuca varırdı, çünkü her adımda araya üretim giriyor.
 * Kapasitenin sabit oranı doğrusaldır ve adımlara bölününce aynı sonucu verir.
 */
export const SPOIL_RATE = .2;

export function levelOf(game: Pick<Game, "buildings">, type: string) {
  return game.buildings.find(building => building.type === type)?.level ?? 0;
}

/** Her kaynağın tavanı. 0 dönen kaynakta tavan yoktur. */
export function storageCaps(game: Pick<Game, "buildings">): Res {
  const granary = levelOf(game, "granary");
  const warehouse = levelOf(game, "warehouse");
  return {
    food: BASE.food + granary * PER_LEVEL.food,
    ale: BASE.ale + granary * PER_LEVEL.ale,
    wood: BASE.wood + warehouse * PER_LEVEL.wood,
    stone: BASE.stone + warehouse * PER_LEVEL.stone,
    // 0 = tavan yok.
    gold: 0,
    iron: 0,
  };
}

export type Spoilage = { resources: Res; lost: Partial<Record<Key, number>> };

/**
 * Tavanı aşan stoğu bozar. Anında kırpmaz: fazlalık `hours` boyunca
 * SPOIL_RATE ile erir, yani Kralın tepki verecek vakti olur.
 */
export function applySpoilage(resources: Res, caps: Res, hours: number): Spoilage {
  if (hours <= 0) return { resources, lost: {} };
  const next = { ...resources };
  const lost: Partial<Record<Key, number>> = {};

  for (const key of Object.keys(next) as Key[]) {
    const cap = caps[key];
    if (!(cap > 0) || next[key] <= cap) continue;
    const excess = next[key] - cap;
    // Doğrusal kayıp: saatte kapasitenin SPOIL_RATE kadarı. Fazlalık bitince durur.
    const gone = Math.min(excess, cap * SPOIL_RATE * hours);
    lost[key] = gone;
    next[key] = next[key] - gone;
  }
  return { resources: next, lost };
}

/** Doluluk oranı; arayüzde ambarın taşmak üzere olduğunu göstermek için. */
export function fillRatio(resources: Res, caps: Res, key: Key) {
  const cap = caps[key];
  return cap > 0 ? resources[key] / cap : 0;
}
