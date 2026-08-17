import type { Game } from "./types";

/**
 * Halk sistemi: istihkak → mutluluk → üretim ve nüfus.
 *
 * Saf fonksiyonlardır; tick ve emirler bunları kullanır. Mutluluk birikimli
 * değil HEDEFE YAKINSAYAN bir modeldir: mevcut koşullar bir hedef rıza üretir,
 * gerçek rıza saatte birkaç puan o hedefe doğru yürür. Böylece Kral bir ayarı
 * değiştirdiğinde sonucu öngörebilir ve General de gerekçesini açıklayabilir.
 */

/** Kişi başı saatlik temel ihtiyaç. %100 istihkak bu demektir. */
export const NEED = {
  food: 0.035,
  ale: 0.012,
  /** Asker başına saatlik temel maaş. */
  soldierGold: 0.35,
} as const;

export const RATION_LIMITS = { min: 0, max: 200 } as const;

/** Rızanın hedefe yaklaşma hızı (puan/saat). */
const MOOD_APPROACH = 5;

/** Akının hemen ardından hedef rızadan düşülen puan ve sönümlenme sabiti (saat). */
const RAID_TRAUMA = 14;
const RAID_TRAUMA_HALFLIFE = 8;

export type Rations = { food: number; ale: number; soldierPay: number };

export function rationsOf(game: Partial<Game>): Rations {
  return {
    food: clampRation(game.foodRation ?? 100),
    ale: clampRation(game.aleRation ?? 0),
    soldierPay: clampRation(game.soldierPay ?? 100),
  };
}

export const clampRation = (value: number) =>
  Math.max(RATION_LIMITS.min, Math.min(RATION_LIMITS.max, Math.round(Number(value) || 0)));

export const armySize = (units: Record<string, number>) =>
  Object.values(units).reduce((total, amount) => total + Math.max(0, amount), 0);

/** Bir saatlik talep. Karşılanıp karşılanmadığı ayrı hesaplanır. */
export function hourlyDemand(game: Pick<Game, "population" | "units" | "foodRation" | "aleRation" | "soldierPay">) {
  const rations = rationsOf(game);
  const army = armySize(game.units ?? {});
  return {
    food: game.population * NEED.food * (rations.food / 100),
    ale: game.population * NEED.ale * (rations.ale / 100),
    gold: army * NEED.soldierGold * (rations.soldierPay / 100),
  };
}

/** 0 = hiç karşılanmadı, 1 = tam karşılandı. Stok yoksa istihkak kâğıt üstünde kalır. */
export function satisfaction(demand: number, available: number) {
  if (demand <= 0) return 1;
  return Math.max(0, Math.min(1, available / demand));
}

export type MoodInputs = {
  /** Fiilen dağıtılabilen yiyecek istihkakı (%). */
  servedFood: number;
  servedAle: number;
  taxRate: number;
  population: number;
  capacity: number;
  buildings: Array<{ type: string; level: number }>;
  /** Son akından bu yana geçen saat. Akın halkı bir süre sarsılmış bırakır. */
  hoursSinceRaid?: number | null;
};

/** Eğlence ve idare yapılarının rızaya katkısı. */
const AMENITY_VALUE: Record<string, number> = {
  park: 4,
  marriage_hall: 3,
  theater: 7,
  town_square: 2,
};

/**
 * Mevcut koşulların işaret ettiği rıza. Açlık baskındır: istihkak %60'ın
 * altına düştüğünde diğer bütün iyileştirmeler anlamını yitirir.
 */
export function moodTarget(input: MoodInputs) {
  let target = 50;

  // Yiyecek: %100 nötr, altı hızla cezalandırılır, üstü ölçülü ödüllendirir.
  const food = input.servedFood;
  target += food >= 100 ? Math.min(12, (food - 100) * 0.12) : -Math.pow((100 - food) / 100, 1.35) * 55;

  // Aç halk eğlenceye sevinmez: bira ve eğlence yapılarının katkısı tokluk
  // oranıyla ölçeklenir. Aksi hâlde tiyatro açlığı gizleyebiliyordu.
  const fed = Math.max(0, Math.min(1, food / 100));

  target += Math.min(16, input.servedAle * 0.1) * fed;

  // Vergi: %15 nötr kabul edilir.
  target -= (input.taxRate - 15) * 0.9;

  for (const building of input.buildings) {
    const value = AMENITY_VALUE[building.type];
    if (value) target += value * Math.min(3, building.level) * fed;
  }

  // Akın travması: tek seferlik bir rıza düşüşü hedefe yakınsama yüzünden bir
  // saatte siliniyordu, yani yağmalanmak hissedilmiyordu. Artık hedefin kendisi
  // bir süre baskılanır ve yaklaşık bir günde düzelir.
  if (input.hoursSinceRaid !== null && input.hoursSinceRaid !== undefined) {
    target -= RAID_TRAUMA * Math.exp(-Math.max(0, input.hoursSinceRaid) / RAID_TRAUMA_HALFLIFE);
  }

  // Kalabalıklık: kapasitenin %90'ını aşınca huzursuzluk başlar.
  const crowding = input.capacity > 0 ? input.population / input.capacity : 0;
  if (crowding > 0.9) target -= (crowding - 0.9) * 120;

  return Math.max(0, Math.min(100, target));
}

/** Rıza hedefe doğru yürür; ani sıçrama olmaz. */
export function approachMood(current: number, target: number, hours: number) {
  const step = MOOD_APPROACH * hours;
  if (current < target) return Math.min(target, current + step);
  return Math.max(target, current - step);
}

export type MoodState = {
  id: "content" | "uneasy" | "simmering" | "strike" | "revolt";
  label: string;
  /** Üretim çarpanı: iş bırakma ve isyan üretimi düşürür. */
  production: number;
  /** Saatlik nüfus değişimi tabanı (kapasite ve yapılar ayrıca ekler). */
  populationPerHour: number;
};

const STATES: Array<{ min: number } & MoodState> = [
  { min: 70, id: "content", label: "Memnun", production: 1.1, populationPerHour: 0.1 },
  { min: 40, id: "uneasy", label: "Huzursuz", production: 1, populationPerHour: 0.04 },
  { min: 25, id: "simmering", label: "Kaynıyor", production: 0.75, populationPerHour: 0 },
  { min: 10, id: "strike", label: "İş bırakma", production: 0.4, populationPerHour: -0.35 },
  { min: 0, id: "revolt", label: "İsyan", production: 0.05, populationPerHour: -0.9 },
];

/**
 * Askerler huzursuzluğun DIŞA VURUMUNU bastırır, sebebini değil: aç halk aç
 * kalmaya devam eder ama iş bırakma eşiği yükselir. Maaşı ödenmeyen asker
 * bastırmaz; silahlı isyan sivil isyandan ağırdır.
 */
export function suppression(army: number, population: number, soldierUnrest: number) {
  if (population <= 0 || army <= 0) return 0;
  const ratio = army / population;
  const raw = Math.min(14, ratio * 100 * 0.9);
  const reliability = Math.max(0, 1 - soldierUnrest / 60);
  return raw * reliability;
}

export function moodState(popularity: number, suppressionBonus: number): MoodState {
  const effective = Math.max(0, Math.min(100, popularity + suppressionBonus));
  return STATES.find(state => effective >= state.min) ?? STATES[STATES.length - 1];
}

/**
 * Asker huzursuzluğu. Maaş eksik ödendikçe birikir, tam ödendikçe erir.
 * 60 üstünde firar başlar, 85 üstünde silahlı isyan.
 */
export function soldierUnrestAfter(current: number, servedPay: number, hours: number) {
  const shortfall = Math.max(0, 100 - servedPay);
  const delta = shortfall > 0 ? shortfall * 0.06 * hours : -4 * hours;
  return Math.max(0, Math.min(100, current + delta));
}

export const SOLDIER_THRESHOLDS = { demand: 30, desertion: 60, mutiny: 85 } as const;
