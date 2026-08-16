/**
 * Birim tablosu — GDD §7.
 *
 * 17 birim, üç kategori. Tasarımın çekirdek fikri: bir birim "daha güçlü"
 * değildir; daha güçlü **ama** daha pahalı, daha yavaş ve nüfustan daha fazla
 * çalan olur. Bu yüzden her birimin gücü tek bir sayı değil — saldırı/savunma,
 * eğitim süresi, sefer hızı ve nüfus maliyeti birlikte okunmalıdır.
 */

import type { ArmyComposition, BuildingType, ResourceBundle, UnitCategory, UnitType } from './types.js';

export interface UnitDef {
  type: UnitType;
  category: UnitCategory;
  nameTr: string;
  /** Saldırıda taban güç. */
  attack: number;
  /** Savunmada taban güç. */
  defense: number;
  /** Süvariye karşı ek savunma (mızrakçı gibi birimler için). */
  defenseVsCavalry: number;
  /** Sur/kale dayanıklılığına tick başına verdiği hasar. Kuşatma birimlerinde yüksektir. */
  siegePower: number;
  /** Tile başına saniye — düşük olan hızlıdır. Ordunun hızı en yavaş birime eşittir. */
  secondsPerTile: number;
  /** Eğitim süresi (saniye), bina seviyesiyle hızlanır. */
  trainSeconds: number;
  /** Eğitim maliyeti. */
  cost: ResourceBundle;
  /** Nüfus maliyeti — eğitildiği sürece nüfustan düşer. */
  populationCost: number;
  /** Saatlik erzak tüketimi (yiyecek). */
  upkeepFood: number;
  /** Eğitildiği bina. `null` ise binadan bağımsız (Kiralık Asker). */
  trainedAt: BuildingType | null;
  /** Eğitim için gereken en düşük bina seviyesi. */
  requiresBuildingLevel: number;
  /** Bu birimin eğitimi için ordu içinde gereken destek birimi (Mancınık → Mühendis). */
  requiresSupport?: UnitType;
  /** Kervan/yağma taşıma kapasitesi. */
  carryCapacity: number;
  /** Birlik kiralama anlaşmasına (§10.5) konu olabilir mi. */
  rentable: boolean;
  descriptionTr: string;
}

export const UNITS: Record<UnitType, UnitDef> = {
  // ------------------------------------------------- Temel kara birimleri (8)
  spearman: {
    type: 'spearman',
    category: 'infantry',
    nameTr: 'Mızrakçı',
    attack: 10,
    defense: 16,
    defenseVsCavalry: 30,
    siegePower: 0,
    secondsPerTile: 420,
    trainSeconds: 20 * 60,
    cost: { gold: 25, wood: 15, weapons: 1 },
    populationCost: 1,
    upkeepFood: 0.8,
    trainedAt: 'barracks',
    requiresBuildingLevel: 1,
    carryCapacity: 20,
    rentable: true,
    descriptionTr: 'Ucuz, hızlı eğitilen savunma piyadesi. Süvariye karşı belirgin üstün.',
  },
  macebearer: {
    type: 'macebearer',
    category: 'infantry',
    nameTr: 'Topuzcu',
    attack: 22,
    defense: 12,
    defenseVsCavalry: 14,
    siegePower: 4,
    secondsPerTile: 450,
    trainSeconds: 30 * 60,
    cost: { gold: 40, iron: 8, weapons: 2 },
    populationCost: 1,
    upkeepFood: 1.0,
    trainedAt: 'barracks',
    requiresBuildingLevel: 2,
    carryCapacity: 25,
    rentable: true,
    descriptionTr: 'Zırh delen saldırı piyadesi; savunmada zayıftır.',
  },
  swordsman: {
    type: 'swordsman',
    category: 'infantry',
    nameTr: 'Kılıçlı Er',
    attack: 26,
    defense: 24,
    defenseVsCavalry: 20,
    siegePower: 2,
    secondsPerTile: 480,
    trainSeconds: 45 * 60,
    cost: { gold: 60, iron: 14, weapons: 3 },
    populationCost: 2,
    upkeepFood: 1.3,
    trainedAt: 'barracks',
    requiresBuildingLevel: 3,
    carryCapacity: 30,
    rentable: true,
    descriptionTr: 'Dengeli ağır piyade; hem hatta durur hem saldırır.',
  },
  archer: {
    type: 'archer',
    category: 'infantry',
    nameTr: 'Okçu',
    attack: 18,
    defense: 10,
    defenseVsCavalry: 8,
    siegePower: 0,
    secondsPerTile: 400,
    trainSeconds: 35 * 60,
    cost: { gold: 35, wood: 20, weapons: 1 },
    populationCost: 1,
    upkeepFood: 0.8,
    trainedAt: 'archery_range',
    requiresBuildingLevel: 1,
    carryCapacity: 15,
    rentable: true,
    descriptionTr: 'Sur arkasından savunmada değerli; açık alanda kırılgandır.',
  },
  crossbowman: {
    type: 'crossbowman',
    category: 'infantry',
    nameTr: 'Arbaletçi',
    attack: 30,
    defense: 14,
    defenseVsCavalry: 12,
    siegePower: 3,
    secondsPerTile: 500,
    trainSeconds: 55 * 60,
    cost: { gold: 70, iron: 12, wood: 25, weapons: 2 },
    populationCost: 2,
    upkeepFood: 1.2,
    trainedAt: 'archery_range',
    requiresBuildingLevel: 3,
    carryCapacity: 15,
    rentable: true,
    descriptionTr: 'Yavaş ama vurucu; sur savunmasında en etkili menzilli birim.',
  },
  horse_archer: {
    type: 'horse_archer',
    category: 'infantry',
    nameTr: 'Atlı Okçu',
    attack: 28,
    defense: 16,
    defenseVsCavalry: 14,
    siegePower: 0,
    secondsPerTile: 220,
    trainSeconds: 80 * 60,
    cost: { gold: 130, iron: 18, food: 60, weapons: 3 },
    populationCost: 2,
    upkeepFood: 2.2,
    trainedAt: 'stable',
    requiresBuildingLevel: 1,
    carryCapacity: 40,
    rentable: true,
    descriptionTr: 'Çok hızlı akıncı; yağma seferlerinin belkemiği.',
  },
  knight: {
    type: 'knight',
    category: 'infantry',
    nameTr: 'Şövalye',
    attack: 62,
    defense: 44,
    defenseVsCavalry: 36,
    siegePower: 6,
    secondsPerTile: 300,
    trainSeconds: 2 * 3600,
    cost: { gold: 260, iron: 50, food: 120, weapons: 8 },
    populationCost: 3,
    upkeepFood: 3.5,
    trainedAt: 'stable',
    requiresBuildingLevel: 3,
    carryCapacity: 50,
    rentable: true,
    descriptionTr: 'Ağır süvari — en güçlü kara birimi, ama üç kişilik nüfus yer.',
  },
  light_cavalry: {
    type: 'light_cavalry',
    category: 'infantry',
    nameTr: 'Hafif Süvari',
    attack: 34,
    defense: 20,
    defenseVsCavalry: 18,
    siegePower: 0,
    secondsPerTile: 200,
    trainSeconds: 60 * 60,
    cost: { gold: 110, iron: 12, food: 70, weapons: 2 },
    populationCost: 2,
    upkeepFood: 2.0,
    trainedAt: 'stable',
    requiresBuildingLevel: 1,
    carryCapacity: 45,
    rentable: true,
    descriptionTr: 'Ordunun en hızlı birimi; keşif ve hızlı akın için idealdir.',
  },

  // -------------------------------------------------- Kuşatma birimleri (5)
  catapult: {
    type: 'catapult',
    category: 'siege',
    nameTr: 'Mancınık',
    attack: 30,
    defense: 10,
    defenseVsCavalry: 6,
    siegePower: 220,
    secondsPerTile: 1200,
    trainSeconds: 8 * 3600,
    cost: { gold: 400, wood: 300, iron: 120, weapons: 6 },
    populationCost: 5,
    upkeepFood: 3.0,
    trainedAt: 'siege_workshop',
    requiresBuildingLevel: 1,
    requiresSupport: 'engineer',
    carryCapacity: 0,
    rentable: false,
    descriptionTr: 'Sur yıkar. Çok yavaştır — ordunun tamamını kendi hızına düşürür (§7).',
  },
  trebuchet: {
    type: 'trebuchet',
    category: 'siege',
    nameTr: 'Trebuşet',
    attack: 40,
    defense: 12,
    defenseVsCavalry: 6,
    siegePower: 460,
    secondsPerTile: 1800,
    trainSeconds: 14 * 3600,
    cost: { gold: 850, wood: 620, iron: 260, weapons: 12 },
    populationCost: 8,
    upkeepFood: 4.5,
    trainedAt: 'siege_workshop',
    requiresBuildingLevel: 3,
    requiresSupport: 'engineer',
    carryCapacity: 0,
    rentable: false,
    descriptionTr: 'En güçlü kuşatma makinesi; yüksek seviyeli kaleleri makul sürede düşürebilen tek birim.',
  },
  siege_tower: {
    type: 'siege_tower',
    category: 'siege',
    nameTr: 'Kuşatma Kulesi',
    attack: 24,
    defense: 26,
    defenseVsCavalry: 12,
    siegePower: 150,
    secondsPerTile: 1500,
    trainSeconds: 6 * 3600,
    cost: { gold: 320, wood: 380, iron: 60, weapons: 4 },
    populationCost: 4,
    upkeepFood: 2.5,
    trainedAt: 'siege_workshop',
    requiresBuildingLevel: 1,
    carryCapacity: 0,
    rentable: false,
    descriptionTr: 'Piyadeyi surun üstüne taşır; kuşatmada piyade kayıplarını azaltır.',
  },
  battering_ram: {
    type: 'battering_ram',
    category: 'siege',
    nameTr: 'Koçbaşı',
    attack: 20,
    defense: 18,
    defenseVsCavalry: 8,
    siegePower: 180,
    secondsPerTile: 1100,
    trainSeconds: 4 * 3600,
    cost: { gold: 220, wood: 280, iron: 50, weapons: 3 },
    populationCost: 4,
    upkeepFood: 2.2,
    trainedAt: 'siege_workshop',
    requiresBuildingLevel: 1,
    carryCapacity: 0,
    rentable: false,
    descriptionTr: 'Kapıyı hedefler. Hendek varsa etkisi belirgin şekilde düşer.',
  },
  ladderman: {
    type: 'ladderman',
    category: 'siege',
    nameTr: 'Merdivenci',
    attack: 14,
    defense: 8,
    defenseVsCavalry: 6,
    siegePower: 60,
    secondsPerTile: 460,
    trainSeconds: 40 * 60,
    cost: { gold: 45, wood: 40, weapons: 1 },
    populationCost: 1,
    upkeepFood: 0.9,
    trainedAt: 'siege_workshop',
    requiresBuildingLevel: 1,
    carryCapacity: 10,
    rentable: false,
    descriptionTr: 'Ucuz kuşatma desteği; alçak surlara karşı kalabalık halinde işe yarar.',
  },

  // --------------------------------------------- Özel/destek birimler (4)
  engineer: {
    type: 'engineer',
    category: 'special',
    nameTr: 'Mühendis',
    attack: 6,
    defense: 10,
    defenseVsCavalry: 6,
    siegePower: 40,
    secondsPerTile: 520,
    trainSeconds: 90 * 60,
    cost: { gold: 150, wood: 60, iron: 30 },
    populationCost: 2,
    upkeepFood: 1.4,
    trainedAt: 'siege_workshop',
    requiresBuildingLevel: 1,
    carryCapacity: 10,
    rentable: false,
    descriptionTr: 'Kuşatma makinelerini onarır ve çalıştırır; mancınık/trebuşet onsuz sefere çıkamaz.',
  },
  assassin: {
    type: 'assassin',
    category: 'special',
    nameTr: 'Suikastçı',
    attack: 40,
    defense: 6,
    defenseVsCavalry: 4,
    siegePower: 0,
    secondsPerTile: 260,
    trainSeconds: 3 * 3600,
    cost: { gold: 420, iron: 20, weapons: 2 },
    populationCost: 1,
    upkeepFood: 1.0,
    trainedAt: 'barracks',
    requiresBuildingLevel: 5,
    carryCapacity: 0,
    rentable: false,
    descriptionTr: 'Düşmanın casusunu/komuta kademesini hedef alır; garnizon savaşına katılmaz.',
  },
  spy: {
    type: 'spy',
    category: 'special',
    nameTr: 'Casus',
    attack: 2,
    defense: 4,
    defenseVsCavalry: 2,
    siegePower: 0,
    secondsPerTile: 240,
    trainSeconds: 2 * 3600,
    cost: { gold: 200 },
    populationCost: 1,
    upkeepFood: 0.6,
    trainedAt: 'barracks',
    requiresBuildingLevel: 3,
    carryCapacity: 0,
    rentable: false,
    descriptionTr: 'Düşman krallığından üretim/ordu istihbaratı toplar ya da sabotaj yapar (§10.2).',
  },
  mercenary: {
    type: 'mercenary',
    category: 'special',
    nameTr: 'Kiralık Asker',
    attack: 34,
    defense: 30,
    defenseVsCavalry: 22,
    siegePower: 5,
    secondsPerTile: 380,
    trainSeconds: 0,
    cost: { gold: 320 },
    populationCost: 0,
    upkeepFood: 2.6,
    trainedAt: null,
    requiresBuildingLevel: 0,
    carryCapacity: 30,
    rentable: false,
    descriptionTr:
      'Altınla anında satın alınır, nüfus tüketmez ama pahalıdır ve erzak yükü ağırdır. Hem saldırıda hem savunmada kullanılabilir.',
  },
};

export function unitDef(type: UnitType): UnitDef {
  return UNITS[type];
}

/** GDD §10.5: yalnızca temel kara birimleri kiralanabilir. */
export const RENTABLE_UNIT_TYPES: readonly UnitType[] = Object.values(UNITS)
  .filter((u) => u.rentable)
  .map((u) => u.type);

export const UNIT_TYPES_BY_CATEGORY: Record<UnitCategory, UnitType[]> = {
  infantry: [],
  siege: [],
  special: [],
};

for (const def of Object.values(UNITS)) {
  UNIT_TYPES_BY_CATEGORY[def.category].push(def.type);
}

// ---------------------------------------------------------------------------
// Ordu bileşimi yardımcıları
// ---------------------------------------------------------------------------

export function armyUnitCount(army: ArmyComposition): number {
  let total = 0;
  for (const count of Object.values(army)) total += count ?? 0;
  return total;
}

export function armyIsEmpty(army: ArmyComposition): boolean {
  return armyUnitCount(army) <= 0;
}

/** Ordunun toplam nüfus maliyeti. */
export function armyPopulationCost(army: ArmyComposition): number {
  let total = 0;
  for (const [type, count] of Object.entries(army) as [UnitType, number][]) {
    if (count > 0) total += UNITS[type].populationCost * count;
  }
  return total;
}

/** Ordunun saatlik erzak tüketimi. */
export function armyUpkeepFood(army: ArmyComposition): number {
  let total = 0;
  for (const [type, count] of Object.entries(army) as [UnitType, number][]) {
    if (count > 0) total += UNITS[type].upkeepFood * count;
  }
  return total;
}

/** Ordunun yağma taşıma kapasitesi. */
export function armyCarryCapacity(army: ArmyComposition): number {
  let total = 0;
  for (const [type, count] of Object.entries(army) as [UnitType, number][]) {
    if (count > 0) total += UNITS[type].carryCapacity * count;
  }
  return total;
}

/**
 * GDD §7: sefer hızı ordudaki **en yavaş** birimin hızıdır. Mancınık taşıyan
 * bir ordu mancınık hızında yürür — "hızlı akın" ile "gerçek kuşatma"
 * arasındaki farkı hem güçte hem sürede ortaya çıkaran kural budur.
 */
export function armySecondsPerTile(army: ArmyComposition): number {
  let slowest = 0;
  for (const [type, count] of Object.entries(army) as [UnitType, number][]) {
    if (count > 0) slowest = Math.max(slowest, UNITS[type].secondsPerTile);
  }
  return slowest || 420;
}

/** Ordunun toplam kuşatma gücü — sur dayanıklılığını bu değer aşındırır. */
export function armySiegePower(army: ArmyComposition): number {
  let total = 0;
  for (const [type, count] of Object.entries(army) as [UnitType, number][]) {
    if (count > 0) total += UNITS[type].siegePower * count;
  }
  return total;
}

/**
 * Kuşatma makinelerinin çalışması için yeterli mühendis var mı?
 * Her mancınık/trebuşet bir mühendis gerektirir (GDD §7).
 */
export function missingSupportUnits(army: ArmyComposition): { needed: number; available: number } {
  let needed = 0;
  for (const [type, count] of Object.entries(army) as [UnitType, number][]) {
    if (count > 0 && UNITS[type].requiresSupport === 'engineer') needed += count;
  }
  return { needed, available: army.engineer ?? 0 };
}

export function addArmies(a: ArmyComposition, b: ArmyComposition): ArmyComposition {
  const out: ArmyComposition = { ...a };
  for (const [type, count] of Object.entries(b) as [UnitType, number][]) {
    out[type] = (out[type] ?? 0) + count;
  }
  return out;
}

export function subtractArmies(a: ArmyComposition, b: ArmyComposition): ArmyComposition {
  const out: ArmyComposition = { ...a };
  for (const [type, count] of Object.entries(b) as [UnitType, number][]) {
    out[type] = Math.max(0, (out[type] ?? 0) - count);
  }
  return out;
}

/** `a` ordusu `b` ordusunu tamamen kapsıyor mu (kaynak yeterlilik kontrolü). */
export function armyContains(a: ArmyComposition, b: ArmyComposition): boolean {
  for (const [type, count] of Object.entries(b) as [UnitType, number][]) {
    if ((a[type] ?? 0) < count) return false;
  }
  return true;
}

/** Sıfır ve negatif girdileri temizleyerek normalize eder. */
export function normalizeArmy(army: ArmyComposition): ArmyComposition {
  const out: ArmyComposition = {};
  for (const [type, count] of Object.entries(army) as [UnitType, number][]) {
    const n = Math.max(0, Math.trunc(count ?? 0));
    if (n > 0) out[type] = n;
  }
  return out;
}
