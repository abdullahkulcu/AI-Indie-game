import type { Key, Res } from "./types";

/**
 * Birlik ekonomisinin tek kaynağı.
 *
 * Ordu ekranı, General araçları, eğitim emri ve ilerideki sefer çözücüsü bu
 * katalogdan okur. Böylece örneğin Okçunun ek odun maliyeti yalnızca arayüzde
 * görünür ama motorda unutulmuş olmaz.
 */
export type UnitType = "spearman" | "swordsman" | "archer" | "cavalry" | "siege_team" | "mercenary";
export type UnitExperience = Partial<Record<UnitType, number>>;

export type UnitDefinition = {
  type: UnitType;
  name: string;
  role: string;
  barracksLevel: number;
  manpower: number;
  cost: Partial<Res>;
  /** Hız 1 channel'daki oyun saniyesi. */
  trainingSeconds: number;
  upkeep: Pick<Res, "gold" | "food">;
  attack: number;
  defense: number;
  speed: number;
  siege: number;
  /** Kiralık birlik sözleşmeyle gelir; kışlada eğitilemez. */
  trainable?: boolean;
};

export const unitCatalog: readonly UnitDefinition[] = [
  { type: "spearman", name: "Mızrakçı", role: "Hat tutar; süvariye karşı güçlü", barracksLevel: 1, manpower: 1, cost: { gold: 8, food: 10, iron: 1 }, trainingSeconds: 1_200, upkeep: { gold: .35, food: .035 }, attack: 9, defense: 16, speed: 6, siege: 2 },
  { type: "swordsman", name: "Kılıçlı", role: "Dengeli hücum piyadesi", barracksLevel: 2, manpower: 1, cost: { gold: 14, food: 14, iron: 3 }, trainingSeconds: 1_800, upkeep: { gold: .45, food: .04 }, attack: 15, defense: 12, speed: 7, siege: 4 },
  { type: "archer", name: "Okçu", role: "Uzaktan baskı ve açık arazi", barracksLevel: 2, manpower: 1, cost: { gold: 12, food: 12, wood: 8, iron: 1 }, trainingSeconds: 2_100, upkeep: { gold: .4, food: .04 }, attack: 17, defense: 7, speed: 7, siege: 3 },
  { type: "cavalry", name: "Süvari", role: "Hızlı kanat ve takip", barracksLevel: 3, manpower: 2, cost: { gold: 30, food: 24, iron: 5 }, trainingSeconds: 3_300, upkeep: { gold: .8, food: .07 }, attack: 22, defense: 10, speed: 14, siege: 1 },
  { type: "siege_team", name: "Kuşatma Ekibi", role: "Sur ve kale baskısı", barracksLevel: 3, manpower: 4, cost: { gold: 45, food: 30, wood: 40, iron: 8 }, trainingSeconds: 4_800, upkeep: { gold: .7, food: .12 }, attack: 4, defense: 5, speed: 3, siege: 30 },
  // Bu insanlar kiralayan krallığın nüfusundan uzaktadır. Kiracı bakım
  // masrafını üstlenir, fakat eğitim maliyeti ve nüfus kaybı oluşmaz.
  { type: "mercenary", name: "Kiralık Birlik", role: "Sözleşmeli, dengeli piyade", barracksLevel: 0, manpower: 0, cost: {}, trainingSeconds: 0, upkeep: { gold: .65, food: .06 }, attack: 14, defense: 11, speed: 8, siege: 3, trainable: false },
] as const;

export const UNIT_TYPES = unitCatalog.map(unit => unit.type) as UnitType[];

export const unitOf = (type: string): UnitDefinition | null =>
  unitCatalog.find(unit => unit.type === type) ?? null;

export const isUnitType = (type: string): type is UnitType => unitOf(type) !== null;

/** Kışlada doğrudan üretilebilecek birlikler. Kiralık Birlik yalnız anlaşmayla gelir. */
export const isTrainableUnit = (unit: UnitDefinition) => unit.trainable !== false;

/** Birliğin kazanabileceği en yüksek saha deneyimi. */
export const MAX_UNIT_EXPERIENCE = 100;
/** Başarılı bir akında, tam nöbetteki bir birliğin kazandığı deneyim. */
export const RAID_EXPERIENCE_PER_REPULSE = 3;

const clampExperience = (value: unknown) =>
  Math.max(0, Math.min(MAX_UNIT_EXPERIENCE, Number(value) || 0));

/** Eski ya da bozuk kayıtlardaki yabancı birlik deneyimi anahtarlarını atar. */
export function normalizeUnitExperience(value: Record<string, unknown> | null | undefined): UnitExperience {
  const next: UnitExperience = {};
  for (const unit of unitCatalog) {
    const experience = clampExperience(value?.[unit.type]);
    if (experience > 0) next[unit.type] = experience;
  }
  return next;
}

export const experienceOf = (experience: Record<string, number> | null | undefined, type: UnitType) =>
  clampExperience(experience?.[type]);

/** Ordunun mevcut sayısına göre ağırlıklandırılmış deneyim ortalaması. */
export function armyExperience(units: Record<string, number>, experience: Record<string, number> | null | undefined) {
  const soldiers = armySize(units);
  if (!soldiers) return 0;
  return unitCatalog.reduce((total, unit) => total + countOf(units, unit.type) * experienceOf(experience, unit.type), 0) / soldiers;
}

/**
 * Yeni eğitimli askerler tecrübesiz gelir. Böylece eski gaziler kaybolmaz ama
 * ordunun ortalaması, katılan yeni sayıyla doğru oranda seyrelir.
 */
export function recruitUnitExperience(
  before: Record<string, number>,
  experience: Record<string, number> | null | undefined,
  recruits: Record<string, number>,
): UnitExperience {
  const next = normalizeUnitExperience(experience);
  for (const unit of unitCatalog) {
    const oldCount = countOf(before, unit.type);
    const added = Math.max(0, Math.floor(Number(recruits[unit.type]) || 0));
    if (!added) continue;
    const diluted = experienceOf(next, unit.type) * oldCount / Math.max(1, oldCount + added);
    if (diluted > 0) next[unit.type] = diluted;
    else delete next[unit.type];
  }
  return next;
}

/**
 * Kayıp rastgele kabul edilir: hayatta kalanların ortalama deneyimi değişmez,
 * fakat ölenlerin taşıdığı toplam deneyim de birlikle birlikte yok olur.
 */
export function survivorUnitExperience(units: Record<string, number>, experience: Record<string, number> | null | undefined): UnitExperience {
  const next = normalizeUnitExperience(experience);
  for (const unit of unitCatalog) if (!countOf(units, unit.type)) delete next[unit.type];
  return next;
}

/** Başarı yalnız nöbette bulunan orduya yazılır; nöbet düşükse kazanım da düşer. */
export function rewardRaidExperience(
  units: Record<string, number>,
  experience: Record<string, number> | null | undefined,
  watchRatio: number,
  repelled: number,
): UnitExperience {
  const next = survivorUnitExperience(units, experience);
  const gain = RAID_EXPERIENCE_PER_REPULSE * Math.max(0, Math.min(100, watchRatio)) / 100 * Math.max(0, Math.floor(repelled));
  if (!gain) return next;
  for (const unit of unitCatalog) {
    if (!countOf(units, unit.type)) continue;
    const rewarded = clampExperience(experienceOf(next, unit.type) + gain);
    if (rewarded > 0) next[unit.type] = rewarded;
  }
  return next;
}

/**
 * Açık sınır hattında geçen her tam gün, birliklerin birlikte hareket etme
 * deneyimini artırır. Çatışma galibiyeti kadar hızlı değildir; ablukanın
 * gerçek bedeli ikmal ve garnizon kaybı olmaya devam eder.
 */
export function rewardBlockadeExperience(
  units: Record<string, number>,
  experience: Record<string, number> | null | undefined,
  days: number,
): UnitExperience {
  const next = survivorUnitExperience(units, experience);
  const gain = Math.max(0, Math.floor(days));
  if (!gain) return next;
  for (const unit of unitCatalog) {
    if (!countOf(units, unit.type)) continue;
    next[unit.type] = clampExperience(experienceOf(next, unit.type) + gain);
  }
  return next;
}

const countOf = (units: Record<string, number>, type: UnitType) =>
  Math.max(0, Math.floor(Number(units[type]) || 0));

export const armySize = (units: Record<string, number>) =>
  unitCatalog.reduce((total, unit) => total + countOf(units, unit.type), 0);

export const armyManpower = (units: Record<string, number>) =>
  unitCatalog.reduce((total, unit) => total + countOf(units, unit.type) * unit.manpower, 0);

export const armyUpkeep = (units: Record<string, number>) =>
  unitCatalog.reduce((total, unit) => ({
    gold: total.gold + countOf(units, unit.type) * unit.upkeep.gold,
    food: total.food + countOf(units, unit.type) * unit.upkeep.food,
  }), { gold: 0, food: 0 });

export const unitCostFor = (type: UnitType, count: number): Partial<Res> => {
  const unit = unitOf(type)!;
  const amount = Math.max(0, Math.floor(count));
  return Object.fromEntries(Object.entries(unit.cost).map(([key, value]) => [key as Key, (value ?? 0) * amount])) as Partial<Res>;
};

export const trainingDurationMs = (type: UnitType, count: number, speed: number) =>
  Math.max(1, Math.floor(count)) * unitOf(type)!.trainingSeconds * 1_000 / Math.max(1, speed || 1);

/**
 * Tecrübe doğrudan savunmaya girer; tavanı +%25'tir. Bu, deneyimli bir
 * garnizonu anlamlı kılar ama tür, Sur ve arazi avantajlarını geçersiz kılmaz.
 */
export const garrisonDefense = (units: Record<string, number>, experience: Record<string, number> | null | undefined = undefined) =>
  unitCatalog.reduce((total, unit) => total + countOf(units, unit.type) * unit.defense * (1 + experienceOf(experience, unit.type) / 400), 0);
