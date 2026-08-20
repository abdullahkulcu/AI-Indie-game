/**
 * KURULUŞ DURUMUNUN TEK KAYNAĞI.
 *
 * Aynı kuruluş üç ayrı yerde elle yazılıydı ve sessizce sapıyordu:
 *  1) `components/KingdomGame.tsx` → `found()`
 *  2) `components/KingdomGame.tsx` → `kingdomContext(null)` yedeği (saatlik
 *     üretim oranları motordan değil ELDEN geliyordu)
 *  3) `server/save-validation.ts` → `STARTING_STATE`
 * Kapasite ise dördüncü kopyaydı: kuruluşta "150" sabiti yazılıyken motor onu
 * `150 + meydan*80 + (kale-1)*50` ile hesaplıyordu.
 *
 * Bu modül `engine/` altındadır çünkü hem tarayıcı (`components/`) hem sunucu
 * (`server/save-validation.ts`) buradan import edebiliyor. Saf kalır:
 * `Math.random()` ve `Date.now()` yasaktır — `foundKingdom` `now`u parametre
 * olarak alır, böylece aynı `now` ile iki çağrı birebir aynı sonucu verir.
 */

import { materialScaleOf, terrainCatalog } from "./catalog";
import { capacityFor } from "./tick";
import type { Building, Game, Key, Res, TerrainId } from "./types";

export const STARTING_POPULATION = 100;
export const STARTING_TAX_RATE = 15;
export const STARTING_POPULARITY = 50;
export const STARTING_REPUTATION = 50;
export const STARTING_LOYALTY = 75;
/** Kuruluştan sonraki dokunulmazlık süresi (gün). */
export const PROTECTION_DAYS = 4;

export const STARTING_STRATEGY_NOTE =
  "Ekonomiyi dengede tut, halkı aç bırakma ve koruma bitene kadar savunmayı hazırla.";

export const STARTING_BUILDINGS: readonly Building[] = [
  { type: "keep", name: "Kale", category: "Yönetim", level: 1 },
  { type: "wheat_farm", name: "Buğday Tarlası", category: "Ekonomi", level: 1 },
  { type: "lumberjack", name: "Oduncu Kulübesi", category: "Ekonomi", level: 1 },
];

/** Hız 1'deki taban stok. Malzeme kalemleri channel hızıyla ölçeklenir. */
export const STARTING_RESOURCES_BASE: Res = { gold: 1000, food: 500, stone: 300, wood: 300, iron: 100, ale: 0 };

/** Maliyet tarafında da yalnızca bunlar çarpılır (bkz. `costFor`). */
const MATERIAL_KEYS: Key[] = ["wood", "stone", "iron"];

/**
 * Başlangıç stoğu.
 *
 * Yalnızca MALZEME (odun, taş, demir) `materialScaleOf(speed)` ile ölçeklenir;
 * altın, yiyecek ve bira sabit kalır — çünkü maliyet tarafında da yalnızca
 * malzeme çarpılıyor. Simetri böyle kurulur ve ÖLÇÜLDÜ: bu katsayıyla üç hızın
 * her birinde "stok / maliyet" oranı hız 1'deki oranın birebir aynısı olur,
 * yani kuruluşta karşılanabilen bina kümesi de, General'in `majorSpend` teyit
 * eşiği de üç hızda özdeş davranır.
 *
 * Çarpansız hâlde hız 24'te Ambar 3.120 odun istiyordu ama Kralın elinde 300
 * odun vardı: kuruluşta kurulabilen bina sayısı 10/11'den 0/11'e düşüyordu.
 */
export function startingResources(speed: number): Res {
  const scale = materialScaleOf(speed);
  const resources = { ...STARTING_RESOURCES_BASE };
  for (const key of MATERIAL_KEYS) resources[key] = STARTING_RESOURCES_BASE[key] * scale;
  return resources;
}

export type FoundingInput = {
  kingdomName: string;
  rulerName: string;
  channel: string;
  channelId?: string;
  speed: number;
  terrain: TerrainId;
  provider?: string | null;
  model?: string | null;
  generalConnected?: boolean;
};

/** Kuruluş anındaki kanonik krallık. `now` DIŞARIDAN gelir; motor saat okumaz. */
export function foundKingdom(input: FoundingInput, now: number): Game {
  const terrain = terrainCatalog[input.terrain] ?? terrainCatalog.plain;
  const buildings: Building[] = STARTING_BUILDINGS.map(building => ({ ...building }));
  return {
    version: 2,
    kingdomName: input.kingdomName,
    rulerName: input.rulerName,
    channel: input.channel,
    channelId: input.channelId,
    speed: input.speed,
    terrain: input.terrain,
    foundedAt: now,
    lastTickAt: now,
    protectionEndsAt: now + PROTECTION_DAYS * 86_400_000,
    resources: startingResources(input.speed),
    population: STARTING_POPULATION,
    // Elle "150" değil: kapasite formülü motorun tek kaynağından okunur.
    capacity: capacityFor(buildings),
    popularity: STARTING_POPULARITY,
    reputation: STARTING_REPUTATION,
    loyalty: STARTING_LOYALTY,
    taxRate: STARTING_TAX_RATE,
    // Emir kotası kullanılmıyor; alanlar yalnızca tip/eski kayıt uyumu için.
    quota: 2,
    quotaAt: now,
    buildings,
    units: { spearman: 0 },
    foodRation: 100,
    aleRation: 0,
    soldierPay: 100,
    soldierUnrest: 0,
    queue: null,
    notices: [
      { kind: "ARAZİ", text: `${terrain.label} parseli tahsis edildi: ${terrain.bonus}.`, at: now },
      { kind: "KURULUŞ", text: "Krallığınız dış çeperdeki boş parsele kuruldu. Dört günlük korumanız başladı.", at: now },
    ],
    provider: input.provider ?? null,
    model: input.model ?? null,
    generalConnected: input.generalConnected ?? false,
    strategyNote: STARTING_STRATEGY_NOTE,
  };
}
