import type { Key, Res, TerrainId } from "./types";

export const terrainCatalog: Record<TerrainId, {
  label: string; description: string; bonus: string;
  food: number; wood: number; stone: number; iron: number; defense: number; travel: number;
}> = {
  plain: { label: "OVA", description: "Açık tarla ve otlaklar", bonus: "Dengeli üretim · normal hareket", food: 1, wood: 1, stone: 1, iron: 1, defense: 1, travel: 1 },
  forest: { label: "ORMAN", description: "Sık ağaçlık ve dar patikalar", bonus: "+%25 odun · +%16 savunma · yavaş hareket", food: .85, wood: 1.25, stone: 1, iron: 1, defense: 1.16, travel: .85 },
  mountain: { label: "DAĞ", description: "Kayalık sırtlar ve maden damarları", bonus: "+%30 taş/demir · +%25 savunma · çok yavaş hareket", food: .75, wood: .9, stone: 1.3, iron: 1.3, defense: 1.25, travel: .65 },
  riverbank: { label: "NEHİR KIYISI", description: "Verimli kıyı ve geniş geçit", bonus: "+%25 yiyecek · +%8 savunma · yavaş geçiş", food: 1.25, wood: 1, stone: .9, iron: .9, defense: 1.08, travel: .75 },
};

export const catalog = [
  { type: "wheat_farm", name: "Buğday Tarlası", category: "Ekonomi", unlock: 1, seconds: 3600, cost: { wood: 80 }, detail: "+18 yiyecek/sa" },
  { type: "lumberjack", name: "Oduncu Kulübesi", category: "Ekonomi", unlock: 1, seconds: 3600, cost: { gold: 40, stone: 25 }, detail: "+22 odun/sa" },
  { type: "quarry", name: "Taş Ocağı", category: "Ekonomi", unlock: 1, seconds: 5400, cost: { wood: 100, gold: 60 }, detail: "+16 taş/sa" },
  { type: "town_square", name: "Meydan", category: "Yönetim", unlock: 1, seconds: 7200, cost: { wood: 120, stone: 80 }, detail: "+80 nüfus kapasitesi" },
  { type: "barracks", name: "Kışla", category: "Askerî", unlock: 1, seconds: 9000, cost: { wood: 170, stone: 140 }, detail: "Temel birlikleri açar" },
  { type: "apple_orchard", name: "Elma Bahçesi", category: "Ekonomi", unlock: 1, seconds: 4200, cost: { wood: 90, gold: 30 }, detail: "+10 yiyecek/sa" },
  { type: "granary", name: "Ambar", category: "Ekonomi", unlock: 1, seconds: 4800, cost: { wood: 130, stone: 60 }, detail: "Yiyecek ve bira deposu · seviye başına +2.600 yiyecek" },
  { type: "warehouse", name: "Depo", category: "Ekonomi", unlock: 1, seconds: 5400, cost: { wood: 110, stone: 110 }, detail: "Odun ve taş deposu · seviye başına +2.200" },
  { type: "mill", name: "Değirmen", category: "Ekonomi", unlock: 2, seconds: 10800, cost: { wood: 100, stone: 120 }, detail: "Buğday zincirini büyütür" },
  { type: "market", name: "Pazar", category: "Ekonomi", unlock: 2, seconds: 14400, cost: { wood: 160, stone: 80 }, detail: "Kaynak alıp satar · seviye başına 500 birim/gün" },
  { type: "wall", name: "Sur", category: "Askerî", unlock: 3, seconds: 28800, cost: { stone: 500, wood: 100 }, detail: "+%20 savunma" },
  { type: "mine", name: "Maden", category: "Ekonomi", unlock: 1, seconds: 10800, cost: { wood: 150, stone: 80 }, detail: "50.000 cevher rezervi" },
  { type: "park", name: "Park", category: "Halk", unlock: 1, seconds: 3000, cost: { wood: 60, gold: 40 }, detail: "Halkın rızasını yükseltir" },
  { type: "brewery", name: "Bira Evi", category: "Halk", unlock: 2, seconds: 7200, cost: { wood: 140, stone: 90, gold: 80 }, detail: "Bira üretir; bira istihkakını besler" },
  { type: "marriage_hall", name: "Evlilik Dairesi", category: "Halk", unlock: 2, seconds: 8400, cost: { wood: 130, stone: 150, gold: 120 }, detail: "Nüfus artışını hızlandırır" },
  { type: "theater", name: "Tiyatro", category: "Halk", unlock: 3, seconds: 16200, cost: { wood: 260, stone: 320, gold: 260 }, detail: "Büyük rıza; bira tüketir" },
] as const;

/**
 * General'in kurabileceği bina türleri. KATALOGDAN TÜRETİLİR — elle yazılan
 * liste kataloğdan sapıyordu: Ambar, Depo, Park, Bira Evi, Evlilik Dairesi ve
 * Tiyatro araç şemasında hiç yoktu, yani Kral isteyince kurulamıyordu.
 */
export const BUILDABLE_TYPES: string[] = ["keep", ...catalog.map(item => item.type)];

/**
 * Türkçe adlardan bina türüne eşleşme. Yine kataloğdan türetilir; ek takma
 * adlar aksansız ve halk arasındaki kullanımlar içindir.
 */
const EXTRA_ALIASES: Record<string, string[]> = {
  keep: ["kale"],
  wheat_farm: ["bugday tarlasi", "tarla"],
  lumberjack: ["oduncu kulubesi", "oduncu"],
  quarry: ["tas ocagi", "ocak"],
  apple_orchard: ["elma bahcesi", "bahce"],
  granary: ["ambar", "tahil ambari", "zahire"],
  warehouse: ["depo", "ambarlik"],
  mill: ["degirmen"],
  barracks: ["kisla"],
  brewery: ["bira evi", "birahane"],
  marriage_hall: ["evlilik dairesi", "nikah"],
  theater: ["tiyatro"],
  town_square: ["meydan"],
  mine: ["maden"],
  wall: ["sur"],
  market: ["pazar"],
  park: ["park"],
};

export const buildingAliases: Array<[string, string[]]> = BUILDABLE_TYPES.map(type => {
  const name = type === "keep" ? "Kale" : catalog.find(item => item.type === type)?.name ?? type;
  const set = new Set<string>([name.toLocaleLowerCase("tr-TR"), ...(EXTRA_ALIASES[type] ?? [])]);
  return [type, [...set]];
});

/** Kale seviyesi başına yükseltme süresi (saniye); index = mevcut seviye. */
export const keepSeconds = [0, 10800, 28800, 64800, 172800, 388800];

/** Kale yükseltme maliyetleri; index = mevcut seviye. */
export const keepUpgradeCosts: Array<Partial<Res>> = [
  {},
  { gold: 300, stone: 400, wood: 250 },
  { gold: 700, stone: 900, wood: 600 },
  { gold: 1500, stone: 1800, wood: 1100 },
  { gold: 3500, stone: 4000, wood: 2500, iron: 300 },
  { gold: 8000, stone: 9000, wood: 5000, iron: 800 },
];

export const MAX_KEEP_LEVEL = 6;

export const resourceLabels: Array<[Key, string]> = [
  ["gold", "ALTIN"], ["food", "YİYECEK"], ["stone", "TAŞ"],
  ["wood", "ODUN"], ["iron", "DEMİR"], ["ale", "BİRA"],
];

/**
 * KULLANILMIYOR — eski emir kotası kazanımı. Motor kotayı kaldırdı; bu yardımcı
 * yalnızca `components/KingdomGame.tsx` hâlâ import ettiği için duruyor.
 * Arayüzdeki kota göstergesi kalkınca bu satır da silinmeli.
 */
export const quotaPerHour = (level: number) => (level >= 5 ? 6 : level >= 3 ? 5 : 4);
