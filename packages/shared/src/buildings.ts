/**
 * Bina tablosu — GDD §5.
 *
 * 26 bina tipi üç kategoride. Her bina 1..maxLevel arası seviyelenir; maliyet ve
 * inşaat süresi üstel (`levelCostFactor` / `levelTimeFactor`), üretim ise
 * doğrusal (`seviye × taban hız`) büyür. Bu kasıtlı bir asimetri: yükseltmeler
 * giderek pahalılaşırken getirileri sabit arttığı için, tek bir binayı sonuna
 * kadar yükseltmek yerine yatay genişlemek (yeni bina/yeni tile) çoğu noktada
 * daha verimli — GDD §4.1'deki ekonomik genişleme baskısını destekler.
 */

import type {
  BuildingCategory,
  BuildingType,
  ResourceBundle,
  TerrainType,
  UnitType,
} from './types.js';

export interface BuildingDef {
  type: BuildingType;
  category: BuildingCategory;
  nameTr: string;
  /** Referans arayüzdeki SVG sembol kimliği (`#i-wheat` gibi). */
  icon: string;
  maxLevel: number;
  /** Bu binayı inşa edebilmek için gereken Kale seviyesi (GDD §5.1). */
  requiresKeepLevel: number;
  /** Sv.1 inşaat maliyeti. Sv.N maliyeti = baseCost × levelCostFactor^(N-1). */
  baseCost: ResourceBundle;
  /** Sv.1 inşaat süresi (saniye). Sv.N süresi = baseBuildSeconds × levelTimeFactor^(N-1). */
  baseBuildSeconds: number;
  levelCostFactor: number;
  levelTimeFactor: number;
  /** Bina seviyesi başına gereken işçi sayısı (nüfustan çekilir). */
  workersPerLevel: number;
  /** Seviye başına saatlik girdi tüketimi. */
  inputs?: ResourceBundle;
  /** Seviye başına saatlik çıktı üretimi. */
  outputs?: ResourceBundle;
  /**
   * Üretim çözümleme sırası: 0 = ham kaynak (girdisiz), 1 = ara ürün,
   * 2 = nihai ürün. Tick her aşamayı sırayla çözer, böylece aynı tick içinde
   * madenden çıkan cevher dökümhaneye, dökümhanenin demiri silahhaneye akar.
   */
  chainStage: 0 | 1 | 2;
  /** Seviye başına eklenen depolama kapasitesi (Ambar). */
  storagePerLevel?: number;
  /** Seviye başına savunma gücü katkısı (Sur/Kule/Hendek/Kapı). */
  defensePerLevel?: number;
  /** Kuşatmada aşınacak yapısal dayanıklılık (yalnızca Sur ve Kale). */
  integrityPerLevel?: number;
  /** Seviye başına popülerlik katkısı (Kilise, Meydan). */
  popularityPerLevel?: number;
  /** Seviye başına nüfus tavanı katkısı. */
  populationCapPerLevel?: number;
  /** Bu binada eğitilebilen birimler. */
  trains?: UnitType[];
  /** Seviye başına açık tutulabilen pazar ilanı sayısı (GDD §10.6). */
  offerSlotsPerLevel?: number;
  /** Maden rezervi taşıyan bina mı (GDD §4.1). */
  hasMineReserve?: boolean;
  /** Arazi tipine göre üretim çarpanı; belirtilmeyen arazi için 1.0. */
  terrainMultiplier?: Partial<Record<TerrainType, number>>;
  descriptionTr: string;
}

/** Bir binanın aynı anda kaç kopyası kurulabilir (varsayılan 1). */
export const MULTI_INSTANCE_BUILDINGS: ReadonlySet<BuildingType> = new Set<BuildingType>([
  'wheat_farm',
  'apple_orchard',
  'hops_farm',
  'dairy_farm',
  'quarry',
  'mine',
  'woodcutter',
  'tower',
]);

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  // ------------------------------------------------------------------ Ekonomi
  wheat_farm: {
    type: 'wheat_farm',
    category: 'economy',
    nameTr: 'Buğday Tarlası',
    icon: 'i-wheat',
    maxLevel: 8,
    requiresKeepLevel: 1,
    baseCost: { wood: 40, gold: 20 },
    baseBuildSeconds: 900,
    levelCostFactor: 1.6,
    levelTimeFactor: 1.55,
    workersPerLevel: 4,
    outputs: { wheat: 60 },
    chainStage: 0,
    terrainMultiplier: { plains: 1.0, riverbank: 1.25, forest: 0.7, mountain: 0.5, barren: 0.45, pass: 0.8 },
    descriptionTr: 'Ham buğday üretir. Değirmen olmadan tek başına yiyeceğe dönüşmez.',
  },
  apple_orchard: {
    type: 'apple_orchard',
    category: 'economy',
    nameTr: 'Elma Bahçesi',
    icon: 'i-apple',
    maxLevel: 6,
    requiresKeepLevel: 1,
    baseCost: { wood: 30, gold: 30 },
    baseBuildSeconds: 1200,
    levelCostFactor: 1.6,
    levelTimeFactor: 1.55,
    workersPerLevel: 3,
    outputs: { food: 28 },
    chainStage: 0,
    terrainMultiplier: { plains: 1.0, riverbank: 1.2, forest: 0.9, mountain: 0.6, barren: 0.4, pass: 0.8 },
    descriptionTr: 'Zincir gerektirmeden doğrudan yiyecek verir; verimi düşük ama kesintisiz.',
  },
  mill: {
    type: 'mill',
    category: 'economy',
    nameTr: 'Değirmen',
    icon: 'i-mill',
    maxLevel: 6,
    requiresKeepLevel: 1,
    baseCost: { wood: 80, stone: 40, gold: 40 },
    baseBuildSeconds: 2400,
    levelCostFactor: 1.65,
    levelTimeFactor: 1.6,
    workersPerLevel: 3,
    inputs: { wheat: 55 },
    outputs: { flour: 45 },
    chainStage: 1,
    terrainMultiplier: { riverbank: 1.3, plains: 1.0, forest: 0.95, mountain: 0.8, barren: 0.8, pass: 0.9 },
    descriptionTr: 'Buğdayı una çevirir. Kapasitesi tarlaların altında kalırsa zincirin darboğazı olur.',
  },
  bakery: {
    type: 'bakery',
    category: 'economy',
    nameTr: 'Fırın',
    icon: 'i-bread',
    maxLevel: 6,
    requiresKeepLevel: 2,
    baseCost: { wood: 60, stone: 60, gold: 50 },
    baseBuildSeconds: 3000,
    levelCostFactor: 1.65,
    levelTimeFactor: 1.6,
    workersPerLevel: 3,
    inputs: { flour: 40 },
    outputs: { food: 70 },
    chainStage: 2,
    descriptionTr: 'Undan ekmek yapar — krallığın en verimli yiyecek kaynağı.',
  },
  hops_farm: {
    type: 'hops_farm',
    category: 'economy',
    nameTr: 'Şerbetçiotu Tarlası',
    icon: 'i-hops',
    maxLevel: 6,
    requiresKeepLevel: 2,
    baseCost: { wood: 45, gold: 25 },
    baseBuildSeconds: 1500,
    levelCostFactor: 1.6,
    levelTimeFactor: 1.55,
    workersPerLevel: 3,
    outputs: { hops: 40 },
    chainStage: 0,
    terrainMultiplier: { plains: 1.0, riverbank: 1.2, forest: 0.85, mountain: 0.5, barren: 0.4, pass: 0.8 },
    descriptionTr: 'Bira imalathanesinin tek girdisi.',
  },
  brewery: {
    type: 'brewery',
    category: 'economy',
    nameTr: 'Bira İmalathanesi',
    icon: 'i-hops',
    maxLevel: 6,
    requiresKeepLevel: 2,
    baseCost: { wood: 90, stone: 50, gold: 70 },
    baseBuildSeconds: 3600,
    levelCostFactor: 1.65,
    levelTimeFactor: 1.6,
    workersPerLevel: 4,
    inputs: { hops: 35 },
    outputs: { ale: 26 },
    chainStage: 2,
    terrainMultiplier: { riverbank: 1.25, plains: 1.0, forest: 1.0, mountain: 0.9, barren: 0.85, pass: 0.95 },
    descriptionTr: 'Bira üretir; halkın rızasını yükselten temel lüks üründür (§6).',
  },
  dairy_farm: {
    type: 'dairy_farm',
    category: 'economy',
    nameTr: 'Süt Çiftliği',
    icon: 'i-cheese',
    maxLevel: 5,
    requiresKeepLevel: 2,
    baseCost: { wood: 55, gold: 45 },
    baseBuildSeconds: 1800,
    levelCostFactor: 1.6,
    levelTimeFactor: 1.55,
    workersPerLevel: 3,
    inputs: { wheat: 10 },
    outputs: { milk: 40 },
    chainStage: 1,
    terrainMultiplier: { plains: 1.15, riverbank: 1.1, forest: 0.9, mountain: 0.7, barren: 0.5, pass: 0.85 },
    descriptionTr: 'Sürüsünü beslemek için az miktarda buğday tüketir, süt verir.',
  },
  cheesemaker: {
    type: 'cheesemaker',
    category: 'economy',
    nameTr: 'Peynirhane',
    icon: 'i-cheese',
    maxLevel: 5,
    requiresKeepLevel: 3,
    baseCost: { wood: 70, stone: 50, gold: 60 },
    baseBuildSeconds: 3000,
    levelCostFactor: 1.65,
    levelTimeFactor: 1.6,
    workersPerLevel: 3,
    inputs: { milk: 35 },
    outputs: { food: 26, cheese: 14 },
    chainStage: 2,
    descriptionTr: 'Hem yiyecek hem küçük bir popülerlik bonusu veren peynir üretir.',
  },
  quarry: {
    type: 'quarry',
    category: 'economy',
    nameTr: 'Taş Ocağı',
    icon: 'i-quarry',
    maxLevel: 8,
    requiresKeepLevel: 1,
    baseCost: { wood: 60, gold: 40 },
    baseBuildSeconds: 1800,
    levelCostFactor: 1.62,
    levelTimeFactor: 1.58,
    workersPerLevel: 5,
    outputs: { stone: 34 },
    chainStage: 0,
    terrainMultiplier: { mountain: 1.4, pass: 1.15, plains: 1.0, forest: 0.85, riverbank: 0.8, barren: 0.9 },
    descriptionTr: 'Doğrudan taş çıkarır; sur ve kale yükseltmelerinin belkemiği.',
  },
  mine: {
    type: 'mine',
    category: 'economy',
    nameTr: 'Maden',
    icon: 'i-ore',
    maxLevel: 8,
    requiresKeepLevel: 2,
    baseCost: { wood: 90, stone: 60, gold: 70 },
    baseBuildSeconds: 3600,
    levelCostFactor: 1.62,
    levelTimeFactor: 1.58,
    workersPerLevel: 6,
    outputs: { ore: 50 },
    chainStage: 0,
    hasMineReserve: true,
    terrainMultiplier: { mountain: 1.45, pass: 1.1, plains: 1.0, forest: 0.85, riverbank: 0.8, barren: 0.95 },
    descriptionTr: 'Ham cevher çıkarır. Rezervi sınırlıdır ve tükenir (§4.1).',
  },
  foundry: {
    type: 'foundry',
    category: 'economy',
    nameTr: 'Dökümhane',
    icon: 'i-foundry',
    maxLevel: 6,
    requiresKeepLevel: 3,
    baseCost: { wood: 110, stone: 90, gold: 90 },
    baseBuildSeconds: 5400,
    levelCostFactor: 1.68,
    levelTimeFactor: 1.62,
    workersPerLevel: 5,
    inputs: { ore: 45, wood: 10 },
    outputs: { iron: 30 },
    chainStage: 1,
    descriptionTr: 'Ham cevheri demire dönüştürür.',
  },
  woodcutter: {
    type: 'woodcutter',
    category: 'economy',
    nameTr: 'Oduncu Kulübesi',
    icon: 'i-wood',
    maxLevel: 8,
    requiresKeepLevel: 1,
    baseCost: { wood: 25, gold: 20 },
    baseBuildSeconds: 900,
    levelCostFactor: 1.6,
    levelTimeFactor: 1.55,
    workersPerLevel: 4,
    outputs: { wood: 42 },
    chainStage: 0,
    terrainMultiplier: { forest: 1.5, riverbank: 1.05, plains: 1.0, mountain: 0.8, pass: 0.85, barren: 0.4 },
    descriptionTr: 'Ormandan odun keser; orman arazisinde belirgin biçimde verimlidir.',
  },
  market: {
    type: 'market',
    category: 'economy',
    nameTr: 'Pazar',
    icon: 'i-market',
    maxLevel: 6,
    requiresKeepLevel: 3,
    baseCost: { wood: 120, stone: 80, gold: 150 },
    baseBuildSeconds: 5400,
    levelCostFactor: 1.7,
    levelTimeFactor: 1.6,
    workersPerLevel: 4,
    outputs: { gold: 12 },
    chainStage: 2,
    offerSlotsPerLevel: 2,
    descriptionTr: 'Açık ticaret ilanı yayınlamayı ve başkalarının ilanlarını kabul etmeyi sağlar (§10.6).',
  },
  granary: {
    type: 'granary',
    category: 'economy',
    nameTr: 'Ambar',
    icon: 'i-granary',
    maxLevel: 6,
    requiresKeepLevel: 1,
    baseCost: { wood: 80, stone: 60, gold: 40 },
    baseBuildSeconds: 2400,
    levelCostFactor: 1.7,
    levelTimeFactor: 1.6,
    workersPerLevel: 2,
    chainStage: 2,
    storagePerLevel: 2200,
    descriptionTr: 'Depolama kapasitesini artırır. Kapasite dolduğunda üretim ziyan olur.',
  },

  // ------------------------------------------------------------------ Askeri
  barracks: {
    type: 'barracks',
    category: 'military',
    nameTr: 'Kışla',
    icon: 'i-sword',
    maxLevel: 6,
    requiresKeepLevel: 2,
    baseCost: { wood: 100, stone: 80, gold: 80 },
    baseBuildSeconds: 3600,
    levelCostFactor: 1.68,
    levelTimeFactor: 1.6,
    workersPerLevel: 3,
    chainStage: 2,
    trains: ['spearman', 'macebearer', 'swordsman'],
    descriptionTr: 'Temel piyade eğitir. Seviyesi eğitim hızını artırır.',
  },
  archery_range: {
    type: 'archery_range',
    category: 'military',
    nameTr: 'Okçu Meydanı',
    icon: 'i-bow',
    maxLevel: 6,
    requiresKeepLevel: 2,
    baseCost: { wood: 120, stone: 40, gold: 70 },
    baseBuildSeconds: 3600,
    levelCostFactor: 1.68,
    levelTimeFactor: 1.6,
    workersPerLevel: 3,
    chainStage: 2,
    trains: ['archer', 'crossbowman'],
    descriptionTr: 'Okçu ve arbaletçi eğitir.',
  },
  stable: {
    type: 'stable',
    category: 'military',
    nameTr: 'Ahır',
    icon: 'i-horse',
    maxLevel: 6,
    requiresKeepLevel: 3,
    baseCost: { wood: 140, stone: 60, gold: 120, food: 100 },
    baseBuildSeconds: 5400,
    levelCostFactor: 1.7,
    levelTimeFactor: 1.62,
    workersPerLevel: 4,
    chainStage: 2,
    trains: ['horse_archer', 'knight', 'light_cavalry'],
    descriptionTr: 'Süvari birimleri eğitir; hızlı akınların kaynağı.',
  },
  armory: {
    type: 'armory',
    category: 'military',
    nameTr: 'Silahhane',
    icon: 'i-foundry',
    maxLevel: 6,
    requiresKeepLevel: 5,
    baseCost: { wood: 150, stone: 120, iron: 60, gold: 140 },
    baseBuildSeconds: 7200,
    levelCostFactor: 1.7,
    levelTimeFactor: 1.62,
    workersPerLevel: 4,
    inputs: { iron: 22, wood: 18 },
    outputs: { weapons: 16 },
    chainStage: 2,
    descriptionTr: 'Demir ve odundan silah/zırh üretir; birim eğitiminde tüketilir.',
  },
  siege_workshop: {
    type: 'siege_workshop',
    category: 'military',
    nameTr: 'Kuşatma Atölyesi',
    icon: 'i-siege',
    maxLevel: 4,
    requiresKeepLevel: 5,
    baseCost: { wood: 220, stone: 140, iron: 90, gold: 200 },
    baseBuildSeconds: 10800,
    levelCostFactor: 1.75,
    levelTimeFactor: 1.65,
    workersPerLevel: 5,
    chainStage: 2,
    trains: ['catapult', 'trebuchet', 'siege_tower', 'battering_ram', 'ladderman'],
    descriptionTr: 'Kuşatma makineleri üretir — yüksek surlu bir kaleyi düşürmenin tek yolu (§7).',
  },
  tower: {
    type: 'tower',
    category: 'military',
    nameTr: 'Kule',
    icon: 'i-tower',
    maxLevel: 6,
    requiresKeepLevel: 3,
    baseCost: { stone: 140, wood: 50, gold: 60 },
    baseBuildSeconds: 4200,
    levelCostFactor: 1.7,
    levelTimeFactor: 1.6,
    workersPerLevel: 1,
    chainStage: 2,
    defensePerLevel: 55,
    descriptionTr: 'Savunma gücüne doğrudan katkı yapar; birden fazla kule kurulabilir.',
  },
  wall: {
    type: 'wall',
    category: 'military',
    nameTr: 'Sur',
    icon: 'i-wall',
    maxLevel: 6,
    requiresKeepLevel: 3,
    baseCost: { stone: 200, wood: 60, gold: 80 },
    baseBuildSeconds: 6000,
    levelCostFactor: 1.75,
    levelTimeFactor: 1.65,
    workersPerLevel: 1,
    chainStage: 2,
    defensePerLevel: 90,
    integrityPerLevel: 900,
    descriptionTr: 'Hem savunma gücünü hem kuşatma süresini belirler — takviyenin yetişmesi için zaman kazandırır (§8.2).',
  },
  moat: {
    type: 'moat',
    category: 'military',
    nameTr: 'Hendek',
    icon: 'i-wall',
    maxLevel: 4,
    requiresKeepLevel: 3,
    baseCost: { stone: 90, wood: 40, gold: 50 },
    baseBuildSeconds: 3600,
    levelCostFactor: 1.7,
    levelTimeFactor: 1.6,
    workersPerLevel: 1,
    chainStage: 2,
    defensePerLevel: 40,
    descriptionTr: 'Koçbaşı ve merdivencilerin etkisini kırar, kuşatmayı yavaşlatır.',
  },
  gate: {
    type: 'gate',
    category: 'military',
    nameTr: 'Kapı',
    icon: 'i-wall',
    maxLevel: 4,
    requiresKeepLevel: 3,
    baseCost: { stone: 110, wood: 80, iron: 30, gold: 70 },
    baseBuildSeconds: 4200,
    levelCostFactor: 1.7,
    levelTimeFactor: 1.6,
    workersPerLevel: 1,
    chainStage: 2,
    defensePerLevel: 35,
    descriptionTr: 'Surun en zayıf noktasını güçlendirir.',
  },

  // ---------------------------------------------------------------- Yönetim
  keep: {
    type: 'keep',
    category: 'administration',
    nameTr: 'Kale',
    icon: 'i-keep',
    maxLevel: 6,
    requiresKeepLevel: 1,
    // GDD §5.1: Sv.2 ~3sa, Sv.3 ~8sa, Sv.4 ~18sa, Sv.5 ~2gün, Sv.6 ~4-5gün.
    // Bu eğri KEEP_LEVELS tablosundaki mutlak değerlerle geçersiz kılınır.
    baseCost: { stone: 300, wood: 220, gold: 250 },
    baseBuildSeconds: 10800,
    levelCostFactor: 2.15,
    levelTimeFactor: 2.35,
    workersPerLevel: 6,
    chainStage: 2,
    defensePerLevel: 70,
    integrityPerLevel: 1400,
    populationCapPerLevel: 180,
    descriptionTr:
      'Krallığın ana binası; idari kapasiteyi, emir kotasını ve hangi binaların açık olduğunu belirler (§5.1).',
  },
  town_square: {
    type: 'town_square',
    category: 'administration',
    nameTr: 'Meydan',
    icon: 'i-banner',
    maxLevel: 6,
    requiresKeepLevel: 1,
    baseCost: { stone: 90, wood: 70, gold: 60 },
    baseBuildSeconds: 2700,
    levelCostFactor: 1.7,
    levelTimeFactor: 1.6,
    workersPerLevel: 2,
    chainStage: 2,
    popularityPerLevel: 2,
    populationCapPerLevel: 120,
    descriptionTr: 'Nüfus artış hızını ve tavanını birlikte yükseltir — erken inşa etmeye değer (§6.1).',
  },
  chapel: {
    type: 'chapel',
    category: 'administration',
    nameTr: 'Kilise',
    icon: 'i-church',
    maxLevel: 5,
    requiresKeepLevel: 2,
    baseCost: { stone: 130, wood: 80, gold: 100 },
    baseBuildSeconds: 4200,
    levelCostFactor: 1.7,
    levelTimeFactor: 1.6,
    workersPerLevel: 2,
    chainStage: 2,
    popularityPerLevel: 4,
    descriptionTr: 'Popülerlik ve moral bonusu verir; savaş kayıplarının moral etkisini yumuşatır.',
  },
};

/**
 * Kale seviyeleri — GDD §5.1'deki tablo birebir.
 * `buildSeconds` burada mutlak verilir; üstel eğri yerine tasarımın istediği
 * ~3sa / ~8sa / ~18sa / ~2gün / ~4-5gün temposu kullanılır.
 */
export interface KeepLevelDef {
  level: number;
  buildSeconds: number;
  cost: ResourceBundle;
  buildingSlots: number;
  decreeQuotaPerHour: number;
  /** Bu seviyede açılan yetenekler (oyuncuya gösterilen açıklama). */
  unlocksTr: string;
}

export const KEEP_LEVELS: readonly KeepLevelDef[] = [
  {
    level: 1,
    buildSeconds: 0,
    cost: {},
    buildingSlots: 6,
    decreeQuotaPerHour: 2,
    unlocksTr: 'Temel kapasite, 6 bina slotu, Emir Kotası 2/saat',
  },
  {
    level: 2,
    buildSeconds: 3 * 3600,
    cost: { stone: 300, wood: 220, gold: 250 },
    buildingSlots: 8,
    decreeQuotaPerHour: 2,
    unlocksTr: '+2 bina slotu',
  },
  {
    level: 3,
    buildSeconds: 8 * 3600,
    cost: { stone: 700, wood: 500, gold: 600 },
    buildingSlots: 11,
    decreeQuotaPerHour: 3,
    unlocksTr: 'Sur inşa edilebilir hale gelir, Emir Kotası 3/saat',
  },
  {
    level: 4,
    buildSeconds: 18 * 3600,
    cost: { stone: 1600, wood: 1100, gold: 1400, iron: 200 },
    buildingSlots: 14,
    decreeQuotaPerHour: 3,
    unlocksTr: 'Ambar ve Pazar üst seviyeleri açılır',
  },
  {
    level: 5,
    buildSeconds: 48 * 3600,
    cost: { stone: 3600, wood: 2400, gold: 3200, iron: 600 },
    buildingSlots: 18,
    decreeQuotaPerHour: 4,
    unlocksTr: 'Tüm bina tipleri açılır (Silahhane, Kuşatma Atölyesi dahil), Emir Kotası 4/saat',
  },
  {
    level: 6,
    buildSeconds: 108 * 3600,
    cost: { stone: 8000, wood: 5200, gold: 7500, iron: 1600 },
    buildingSlots: 24,
    decreeQuotaPerHour: 4,
    unlocksTr: 'Tam idari kapasite, en yüksek üretim ve depolama çarpanları',
  },
];

export const MAX_KEEP_LEVEL = KEEP_LEVELS.length;

export function keepLevelDef(level: number): KeepLevelDef {
  const clamped = Math.min(Math.max(Math.trunc(level), 1), MAX_KEEP_LEVEL);
  // KEEP_LEVELS 1..6 arası kesintisiz doldurulduğu için bu erişim daima tanımlıdır.
  return KEEP_LEVELS[clamped - 1]!;
}

export function buildingDef(type: BuildingType): BuildingDef {
  return BUILDINGS[type];
}

export const BUILDING_TYPES_BY_CATEGORY: Record<BuildingCategory, BuildingType[]> = {
  economy: [],
  military: [],
  administration: [],
};

for (const def of Object.values(BUILDINGS)) {
  BUILDING_TYPES_BY_CATEGORY[def.category].push(def.type);
}
