/**
 * Oyunun tüm sayısal kuralları.
 *
 * Bu dosya saf fonksiyonlardan oluşur — veritabanı, ağ ya da zaman bilgisine
 * dokunmaz. Sebebi GDD §15.5'teki altın kural: LLM'in verdiği hiçbir sayıya
 * güvenilmez, her aksiyon backend'de yeniden hesaplanır. Hesabın tek bir yerde
 * ve test edilebilir biçimde durması bu doğrulamayı mümkün kılıyor.
 */

import { BALANCE } from './balance.js';
import { BUILDINGS, keepLevelDef, MAX_KEEP_LEVEL } from './buildings.js';
import { TERRAIN } from './terrain.js';
import {
  armySecondsPerTile,
  armySiegePower,
  armyUnitCount,
  armyUpkeepFood,
  UNITS,
} from './units.js';
import {
  RESOURCES,
  type ArmyComposition,
  type BuildingType,
  type Resource,
  type ResourceBundle,
  type ResourceLedger,
  type Tactic,
  type TerrainType,
  type UnitType,
} from './types.js';

// ---------------------------------------------------------------------------
// Küçük yardımcılar
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function emptyLedger(): ResourceLedger {
  const ledger = {} as ResourceLedger;
  for (const r of RESOURCES) ledger[r] = 0;
  return ledger;
}

export function toLedger(bundle: ResourceBundle): ResourceLedger {
  const ledger = emptyLedger();
  for (const r of RESOURCES) ledger[r] = bundle[r] ?? 0;
  return ledger;
}

export function scaleBundle(bundle: ResourceBundle, factor: number): ResourceBundle {
  const out: ResourceBundle = {};
  for (const [key, value] of Object.entries(bundle) as [Resource, number][]) {
    if (value) out[key] = value * factor;
  }
  return out;
}

export function addBundles(a: ResourceBundle, b: ResourceBundle): ResourceBundle {
  const out: ResourceBundle = { ...a };
  for (const [key, value] of Object.entries(b) as [Resource, number][]) {
    out[key] = (out[key] ?? 0) + (value ?? 0);
  }
  return out;
}

/** `stock` bundle'ı karşılayabiliyor mu; karşılamıyorsa eksik kalemleri döndürür. */
export function missingResources(
  stock: ResourceLedger,
  cost: ResourceBundle,
): ResourceBundle | null {
  const missing: ResourceBundle = {};
  let any = false;
  for (const [key, value] of Object.entries(cost) as [Resource, number][]) {
    const need = value ?? 0;
    if (need <= 0) continue;
    const have = stock[key] ?? 0;
    if (have < need) {
      missing[key] = Math.ceil(need - have);
      any = true;
    }
  }
  return any ? missing : null;
}

// ---------------------------------------------------------------------------
// Bina maliyet / süre eğrileri
// ---------------------------------------------------------------------------

/**
 * Bir binanın belirtilen seviyeye çıkarılma maliyeti.
 * Kale için GDD §5.1'deki mutlak tablo kullanılır; diğerlerinde üstel eğri.
 */
export function buildingCostAtLevel(type: BuildingType, level: number): ResourceBundle {
  if (type === 'keep') {
    return { ...keepLevelDef(level).cost };
  }
  const def = BUILDINGS[type];
  const factor = Math.pow(def.levelCostFactor, Math.max(0, level - 1));
  const out: ResourceBundle = {};
  for (const [key, value] of Object.entries(def.baseCost) as [Resource, number][]) {
    if (value) out[key] = Math.round(value * factor);
  }
  return out;
}

/**
 * İnşaat/yükseltme süresi. Yüksek Kale seviyesi tüm inşaatları hızlandırır —
 * idari kapasite artışının somut karşılığı.
 */
export function buildingBuildSeconds(
  type: BuildingType,
  level: number,
  keepLevel: number,
): number {
  const raw =
    type === 'keep'
      ? keepLevelDef(level).buildSeconds
      : BUILDINGS[type].baseBuildSeconds *
        Math.pow(BUILDINGS[type].levelTimeFactor, Math.max(0, level - 1));
  // Kale her seviyede inşaat sürelerini %6 kısaltır; kendi yükseltmesi hariç.
  const speedup = type === 'keep' ? 1 : Math.pow(0.94, Math.max(0, keepLevel - 1));
  return Math.max(30, Math.round(raw * speedup));
}

/** Kale seviyesine göre kullanılabilir bina slotu sayısı (§5.1). */
export function buildingSlots(keepLevel: number): number {
  return keepLevelDef(keepLevel).buildingSlots;
}

/** Bir bina tipi bu Kale seviyesinde açık mı (§5.1). */
export function isBuildingUnlocked(type: BuildingType, keepLevel: number): boolean {
  return keepLevel >= BUILDINGS[type].requiresKeepLevel;
}

/** Kale seviyesi + Ambar seviyeleri toplam depolama kapasitesini verir. */
export function storageCapacity(keepLevel: number, granaryLevels: number[]): number {
  const granary = granaryLevels.reduce(
    (sum, lvl) => sum + lvl * (BUILDINGS.granary.storagePerLevel ?? 0),
    0,
  );
  return (
    BALANCE.resources.baseStorageCapacity +
    keepLevel * BALANCE.resources.storagePerKeepLevel +
    granary
  );
}

// ---------------------------------------------------------------------------
// Maden tükenme mekaniği (GDD §4.1)
// ---------------------------------------------------------------------------

export function mineReserveCapacity(level: number): number {
  return BALANCE.mine.reservePerLevel * Math.max(1, level);
}

/**
 * Taper eğrisi: rezerv %20'nin üzerindeyken tam kapasite; altında üretim
 * `kalan% / 20%` oranıyla doğrusal olarak sıfıra iner.
 */
export function mineProductionMultiplier(remaining: number, capacity: number): number {
  if (capacity <= 0) return 0;
  if (remaining <= 0) return 0;
  const share = remaining / capacity;
  if (share >= BALANCE.mine.taperThreshold) return 1;
  return clamp(share / BALANCE.mine.taperThreshold, 0, 1);
}

/**
 * Derin kazı maliyeti — her kullanımda 1.5× artar (500 → 750 → 1125...).
 * Sert bir üst sınır yok; mekanik kendini ekonomik olarak anlamsızlaştırır.
 */
export function deepExcavationCost(timesUsed: number): number {
  return Math.round(
    BALANCE.mine.deepExcavationBaseCost *
      Math.pow(BALANCE.mine.deepExcavationCostFactor, Math.max(0, timesUsed)),
  );
}

export function deepExcavationRefund(level: number): number {
  return Math.round(mineReserveCapacity(level) * BALANCE.mine.deepExcavationRefundRatio);
}

// ---------------------------------------------------------------------------
// Üretim zinciri (GDD §4)
// ---------------------------------------------------------------------------

export interface ProductionBuilding {
  /** Veritabanındaki BuildingInstance kimliği — darboğaz raporunda geri verilir. */
  id: string;
  type: BuildingType;
  level: number;
  terrain: TerrainType;
  /** Yalnızca maden için: kalan rezerv. */
  mineReserveRemaining?: number;
}

export interface Bottleneck {
  buildingId: string;
  buildingType: BuildingType;
  /** Üretimin hangi orana düştüğü (0..1). */
  utilization: number;
  /** Darboğazın sebebi. */
  reason: 'input_shortage' | 'worker_shortage' | 'storage_full' | 'reserve_depleted';
  /** `input_shortage` ise eksik olan kaynak. */
  limitingResource?: Resource;
}

export interface ProductionInput {
  buildings: ProductionBuilding[];
  stock: ResourceLedger;
  /** Altın dışındaki her kaynak için üst sınır. */
  capacity: number;
  hours: number;
  population: number;
  /** Orduya gitmemiş, çalışabilir nüfus. */
  availableWorkers: number;
  /** 0-100. */
  taxRate: number;
  /** Dünya olayı çarpanları (bereketli hasat vb.). */
  foodMultiplier?: number;
  /** Ordunun saatlik erzak tüketimi. */
  armyUpkeepFoodPerHour?: number;
}

export interface ProductionResult {
  /** Pencere boyunca üretilen brüt miktarlar. */
  produced: ResourceBundle;
  /** Pencere boyunca tüketilen miktarlar (girdi + halk + ordu). */
  consumed: ResourceBundle;
  /** Depo dolduğu için ziyan olan üretim. */
  wasted: ResourceBundle;
  finalStock: ResourceLedger;
  bottlenecks: Bottleneck[];
  /** İşçi kapasitesinin karşıladığı oran (0..1). */
  workerUtilization: number;
  /** Maden kimliği → bu pencerede tükettiği rezerv. */
  mineReserveConsumed: Record<string, number>;
  /** Yiyecek üretimi tüketimi karşılıyor mu (popülerlik hesabına girer). */
  foodBalancePerHour: number;
}

/**
 * Lazy üretim: son tick'ten bu yana geçen süre için üretim zincirini çözer.
 *
 * Zincir aşama aşama işlenir (ham → ara → nihai), böylece madenden çıkan cevher
 * aynı pencerede dökümhaneye, dökümhanenin demiri silahhaneye akabilir. Bir
 * binanın çıktısı girdisinin ne kadarını bulabildiğine göre ölçeklenir — GDD
 * §4'teki darboğaz davranışı doğrudan buradan doğar.
 */
export function computeProduction(input: ProductionInput): ProductionResult {
  const hours = Math.max(0, input.hours);
  const stock = { ...input.stock };
  const produced: ResourceBundle = {};
  const consumed: ResourceBundle = {};
  const wasted: ResourceBundle = {};
  const bottlenecks: Bottleneck[] = [];
  const mineReserveConsumed: Record<string, number> = {};

  // --- İşçi kapasitesi -------------------------------------------------
  let workersNeeded = 0;
  for (const b of input.buildings) workersNeeded += b.level * BUILDINGS[b.type].workersPerLevel;
  const workerUtilization =
    workersNeeded <= 0 ? 1 : clamp(input.availableWorkers / workersNeeded, 0, 1);

  if (hours === 0) {
    return {
      produced,
      consumed,
      wasted,
      finalStock: stock,
      bottlenecks,
      workerUtilization,
      mineReserveConsumed,
      foodBalancePerHour: 0,
    };
  }

  const capacityFor = (r: Resource): number =>
    (BALANCE.resources.unlimitedStorage as readonly string[]).includes(r)
      ? Number.POSITIVE_INFINITY
      : input.capacity;

  const deposit = (r: Resource, amount: number): void => {
    if (amount <= 0) return;
    produced[r] = (produced[r] ?? 0) + amount;
    const cap = capacityFor(r);
    const room = cap - (stock[r] ?? 0);
    if (amount > room) {
      wasted[r] = (wasted[r] ?? 0) + (amount - Math.max(0, room));
      stock[r] = cap;
    } else {
      stock[r] = (stock[r] ?? 0) + amount;
    }
  };

  const withdraw = (r: Resource, amount: number): void => {
    if (amount <= 0) return;
    consumed[r] = (consumed[r] ?? 0) + amount;
    stock[r] = Math.max(0, (stock[r] ?? 0) - amount);
  };

  let foodProduced = 0;

  // --- Zincir aşamaları -------------------------------------------------
  for (const stage of [0, 1, 2] as const) {
    for (const b of input.buildings) {
      const def = BUILDINGS[b.type];
      if (def.chainStage !== stage) continue;
      if (!def.outputs && !def.inputs) continue;
      if (b.level <= 0) continue;

      const terrainMult = def.terrainMultiplier?.[b.terrain] ?? 1;
      let scale = b.level * terrainMult * workerUtilization * hours;

      // Maden rezervi taper'ı
      if (def.hasMineReserve) {
        const capacity = mineReserveCapacity(b.level);
        const remaining = b.mineReserveRemaining ?? capacity;
        const mult = mineProductionMultiplier(remaining, capacity);
        scale *= mult;
        if (mult <= 0) {
          bottlenecks.push({
            buildingId: b.id,
            buildingType: b.type,
            utilization: 0,
            reason: 'reserve_depleted',
          });
          continue;
        }
      }

      if (scale <= 0) {
        if (workerUtilization < 1) {
          bottlenecks.push({
            buildingId: b.id,
            buildingType: b.type,
            utilization: workerUtilization,
            reason: 'worker_shortage',
          });
        }
        continue;
      }

      // Girdi yeterliliği: her girdi için stoğun karşılayabildiği oran.
      let inputRatio = 1;
      let limitingResource: Resource | undefined;
      if (def.inputs) {
        for (const [res, perLevelHour] of Object.entries(def.inputs) as [Resource, number][]) {
          const need = perLevelHour * scale;
          if (need <= 0) continue;
          const have = stock[res] ?? 0;
          const ratio = have <= 0 ? 0 : clamp(have / need, 0, 1);
          if (ratio < inputRatio) {
            inputRatio = ratio;
            limitingResource = res;
          }
        }
      }

      const effectiveScale = scale * inputRatio;

      if (def.inputs) {
        for (const [res, perLevelHour] of Object.entries(def.inputs) as [Resource, number][]) {
          withdraw(res, perLevelHour * effectiveScale);
        }
      }

      if (def.outputs) {
        for (const [res, perLevelHour] of Object.entries(def.outputs) as [Resource, number][]) {
          let amount = perLevelHour * effectiveScale;
          if (res === 'food' && input.foodMultiplier) amount *= input.foodMultiplier;
          if (res === 'food') foodProduced += amount;
          deposit(res, amount);
        }
      }

      if (def.hasMineReserve && def.outputs) {
        // Çıkarılan her birim çıktı rezervden bir birim eksiltir.
        const extracted = (def.outputs.ore ?? 0) * effectiveScale;
        mineReserveConsumed[b.id] = (mineReserveConsumed[b.id] ?? 0) + extracted;
      }

      // Darboğaz raporlaması — Binalar panelindeki uyarı bunu kullanır.
      const utilization = inputRatio * workerUtilization;
      if (inputRatio < 0.95 && limitingResource) {
        bottlenecks.push({
          buildingId: b.id,
          buildingType: b.type,
          utilization,
          reason: 'input_shortage',
          limitingResource,
        });
      } else if (workerUtilization < 0.95) {
        bottlenecks.push({
          buildingId: b.id,
          buildingType: b.type,
          utilization,
          reason: 'worker_shortage',
        });
      } else if (def.outputs) {
        const full = (Object.keys(def.outputs) as Resource[]).every(
          (r) => (stock[r] ?? 0) >= capacityFor(r) - 1e-6,
        );
        if (full) {
          bottlenecks.push({
            buildingId: b.id,
            buildingType: b.type,
            utilization,
            reason: 'storage_full',
          });
        }
      }
    }
  }

  // --- Vergi geliri -----------------------------------------------------
  const taxGold =
    input.population *
    BALANCE.resources.goldPerCapitaAtFullTax *
    (clamp(input.taxRate, 0, 100) / 100) *
    hours;
  deposit('gold', taxGold);

  // --- Halk ve ordu tüketimi -------------------------------------------
  const civilianFood = input.population * BALANCE.resources.foodPerCapitaPerHour * hours;
  const armyFood = (input.armyUpkeepFoodPerHour ?? 0) * hours;
  withdraw('food', civilianFood + armyFood);
  withdraw('cheese', (stock.cheese ?? 0) * BALANCE.resources.cheeseDecayPerHour * hours);

  const foodBalancePerHour = (foodProduced - civilianFood - armyFood) / hours;

  return {
    produced,
    consumed,
    wasted,
    finalStock: stock,
    bottlenecks,
    workerUtilization,
    mineReserveConsumed,
    foodBalancePerHour,
  };
}

// ---------------------------------------------------------------------------
// Popülerlik ve nüfus (GDD §6)
// ---------------------------------------------------------------------------

export interface PopularityInput {
  taxRate: number;
  /** Saatlik net yiyecek dengesi (üretim - tüketim). */
  foodBalancePerHour: number;
  population: number;
  /** Mevcut bira ve peynir stokları. */
  aleStock: number;
  cheeseStock: number;
  /** Kilise ve Meydan seviyeleri toplamı. */
  chapelLevels: number[];
  townSquareLevels: number[];
  /** Son 24 saatteki savaş sonuçları. */
  recentDefeats: number;
  recentDefenseVictories: number;
  recentAttackVictories: number;
  underSiege: boolean;
  /** Aktif şenlik bonusu (varsa). */
  festivalBonus: number;
}

/**
 * Popülerliğin **hedef** değeri. Gerçek popülerlik bu hedefe saatte
 * `approachRatePerHour` oranıyla yaklaşır — böylece tek bir kötü saat
 * krallığı anında isyana sürüklemez.
 */
export function popularityTarget(input: PopularityInput): number {
  const P = BALANCE.popularity;
  let score = P.neutral;

  // Vergi: nötr oranın üstündeki her puan popülerliği düşürür.
  score -= P.taxWeight * (clamp(input.taxRate, 0, 100) - P.taxNeutralRate);

  // Yiyecek dengesi: kişi başına günlük fazla/açık.
  const pop = Math.max(1, input.population);
  const dailyPerCapita = (input.foodBalancePerHour * 24) / pop;
  if (dailyPerCapita >= 0) {
    score += clamp(dailyPerCapita * P.foodSurplusWeight, 0, 18);
  } else {
    score += clamp(dailyPerCapita * P.foodShortagePenalty, -40, 0);
  }

  // Lüks ürünler: bira ve peynir arzı.
  const alePerCapita = (input.aleStock / pop) * 24;
  score += clamp(alePerCapita * P.aleWeight, 0, P.aleCap);
  const cheesePerCapita = (input.cheeseStock / pop) * 24;
  score += clamp(cheesePerCapita * P.cheeseWeight, 0, P.cheeseCap);

  // Kilise/Manastır ve Meydan.
  for (const lvl of input.chapelLevels) {
    score += lvl * (BUILDINGS.chapel.popularityPerLevel ?? 0);
  }
  for (const lvl of input.townSquareLevels) {
    score += lvl * (BUILDINGS.town_square.popularityPerLevel ?? 0);
  }

  // Savaş sonuçları.
  score -= input.recentDefeats * P.defeatPenalty;
  score += input.recentDefenseVictories * P.defenseVictoryBonus;
  score += input.recentAttackVictories * P.attackVictoryBonus;

  score += input.festivalBonus;

  return clamp(score, 0, 100);
}

/** Popülerliğin hedefe doğru yumuşak hareketi. */
export function advancePopularity(current: number, target: number, hours: number): number {
  if (hours <= 0) return current;
  const rate = 1 - Math.pow(1 - BALANCE.popularity.approachRatePerHour, hours);
  return clamp(current + (target - current) * clamp(rate, 0, 1), 0, 100);
}

/** Nüfus tavanı = f(Kale seviyesi, Meydan seviyesi) — GDD §6.1. */
export function populationCapacity(keepLevel: number, townSquareLevels: number[]): number {
  const keepPart = keepLevel * (BUILDINGS.keep.populationCapPerLevel ?? 0);
  const squarePart = townSquareLevels.reduce(
    (sum, lvl) => sum + lvl * (BUILDINGS.town_square.populationCapPerLevel ?? 0),
    0,
  );
  return BALANCE.population.baseCap + keepPart + squarePart;
}

/**
 * Nüfus artış hızı = f(Popülerlik, Yiyecek fazlası, Meydan seviyesi).
 * Tavana yaklaşırken lojistik olarak yavaşlar.
 */
export function advancePopulation(params: {
  population: number;
  capacity: number;
  popularity: number;
  foodBalancePerHour: number;
  hours: number;
}): number {
  const { population, capacity, popularity, foodBalancePerHour, hours } = params;
  if (hours <= 0) return population;
  const P = BALANCE.population;

  if (popularity < BALANCE.popularity.neutral) {
    // Düşük popülerlik → göç. Popülerlik 0'a yaklaştıkça kayıp hızlanır.
    const severity = (BALANCE.popularity.neutral - popularity) / BALANCE.popularity.neutral;
    const rate = P.maxDeclineRatePerHour * severity;
    return Math.max(0, population * Math.pow(1 - rate, hours));
  }

  // Yiyecek açığı varken nüfus büyümez.
  if (P.requireFoodSurplus && foodBalancePerHour <= 0) return population;

  const drive = (popularity - BALANCE.popularity.neutral) / (100 - BALANCE.popularity.neutral);
  const fill = capacity <= 0 ? 1 : population / capacity;
  const softening = fill >= 1 ? 0 : clamp((1 - fill) / (1 - P.softCapRatio), 0, 1);
  const rate = P.maxGrowthRatePerHour * drive * softening;
  return Math.min(capacity, population * Math.pow(1 + rate, hours));
}

/**
 * Şenlik bonusu — aynı pencerede tekrarlandıkça azalan getiri (GDD §6.2).
 * `priorFestivalsInWindow` son 7 gün içindeki şenlik sayısıdır.
 */
export function festivalBoost(priorFestivalsInWindow: number): number {
  return (
    BALANCE.festival.basePopularityBoost *
    Math.pow(BALANCE.festival.diminishingFactor, Math.max(0, priorFestivalsInWindow))
  );
}

/** Popülerlik isyan eşiğinin altındaysa bu saatte isyan çıkma olasılığı. */
export function revoltChance(popularity: number, hours: number): number {
  if (popularity >= BALANCE.popularity.revoltThreshold) return 0;
  const severity =
    (BALANCE.popularity.revoltThreshold - popularity) / BALANCE.popularity.revoltThreshold;
  return clamp(BALANCE.popularity.revoltChancePerHour * severity * hours, 0, 0.9);
}

// ---------------------------------------------------------------------------
// Emir kotası (GDD §14.4)
// ---------------------------------------------------------------------------

export function decreeQuotaPerHour(keepLevel: number): number {
  return keepLevelDef(keepLevel).decreeQuotaPerHour;
}

export function decreeQuotaCap(keepLevel: number): number {
  return decreeQuotaPerHour(keepLevel) * BALANCE.decreeQuota.maxRolloverHours;
}

/**
 * Kota yenilemesi: geçen saat kadar kota eklenir, `decreeQuotaCap` ile
 * sınırlanır. Rollover sayesinde seyrek giren oyuncu cezalandırılmaz, ama
 * sonsuz biriktirme de engellenir.
 */
export function refillDecreeQuota(params: {
  current: number;
  keepLevel: number;
  hoursElapsed: number;
}): number {
  const perHour = decreeQuotaPerHour(params.keepLevel);
  const cap = decreeQuotaCap(params.keepLevel);
  const gained = Math.floor(params.hoursElapsed) * perHour;
  return Math.min(cap, params.current + gained);
}

export function actionConsumesQuota(action: string): boolean {
  return (BALANCE.decreeQuota.quotaConsumingActions as readonly string[]).includes(action);
}

// ---------------------------------------------------------------------------
// Mesafe, sefer süresi, yorgunluk (GDD §8.3)
// ---------------------------------------------------------------------------

/** Kare grid üzerinde Chebyshev mesafesi (çapraz hareket serbest). */
export function tileDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Sefer süresi — ordunun en yavaş birimi ve hedef arazisi belirler. */
export function marchSeconds(
  army: ArmyComposition,
  distanceTiles: number,
  targetTerrain: TerrainType,
): number {
  const perTile = armySecondsPerTile(army);
  const slowdown = TERRAIN[targetTerrain].marchSlowdown;
  return Math.max(60, Math.round(perTile * Math.max(1, distanceTiles) * slowdown));
}

/**
 * Yorgunluk çarpanı: belirli bir mesafe eşiğinden sonra kademeli güç cezası.
 * Uzak seferleri doğal olarak riskli/az kazançlı kılan denge unsuru.
 */
export function fatigueMultiplier(distanceTiles: number): number {
  const F = BALANCE.fatigue;
  const excess = Math.max(0, distanceTiles - F.freeDistanceTiles);
  return clamp(1 - excess * F.penaltyPerTile, F.minMultiplier, 1);
}

/** Uzun seferlerin ek erzak tüketimi. */
export function marchUpkeepFood(army: ArmyComposition, distanceTiles: number, hours: number): number {
  const base = armyUpkeepFood(army) * hours;
  const excess = Math.max(0, distanceTiles - BALANCE.fatigue.freeDistanceTiles);
  return base * (1 + excess * BALANCE.fatigue.extraUpkeepPerTile);
}

/** Moral çarpanı — popülerlikten beslenir, kilise yumuşatır. */
export function moraleMultiplier(popularity: number, chapelLevels: number[] = []): number {
  const M = BALANCE.morale;
  const base = M.min + (M.max - M.min) * clamp(popularity / 100, 0, 1);
  const chapel = chapelLevels.reduce((s, l) => s + l * M.chapelBonusPerLevel, 0);
  return clamp(base + chapel, M.min, M.max + 0.15);
}

// ---------------------------------------------------------------------------
// Tahkimat ve kuşatma dayanıklılığı
// ---------------------------------------------------------------------------

export interface Fortification {
  keepLevel: number;
  wallLevel: number;
  towerLevels: number[];
  moatLevel: number;
  gateLevel: number;
}

/**
 * Savunma gücüne eklenen yapı bonusu.
 *
 * GDD §8.3 bunu `Kale Sv. × Sur Sv. × Kule Sv.` olarak yazıyor; birebir çarpım
 * surun ya da kulenin olmadığı durumda bonusu sıfırlayacağı için burada
 * toplamsal taban + çarpımsal sinerji olarak modellendi: sur ve kuleler
 * birbirini güçlendirir, ama biri yoksa diğerinin katkısı yok olmaz.
 */
export function fortificationBonus(f: Fortification): number {
  const keep = f.keepLevel * (BUILDINGS.keep.defensePerLevel ?? 0);
  const wall = f.wallLevel * (BUILDINGS.wall.defensePerLevel ?? 0);
  const towers = f.towerLevels.reduce(
    (s, l) => s + l * (BUILDINGS.tower.defensePerLevel ?? 0),
    0,
  );
  const moat = f.moatLevel * (BUILDINGS.moat.defensePerLevel ?? 0);
  const gate = f.gateLevel * (BUILDINGS.gate.defensePerLevel ?? 0);
  const base = keep + wall + towers + moat + gate;
  const towerLevelSum = f.towerLevels.reduce((s, l) => s + l, 0);
  const synergy = 1 + (f.wallLevel * towerLevelSum) / 40;
  return base * synergy * BALANCE.combat.fortificationScale;
}

/** Kuşatmada aşınacak toplam yapısal dayanıklılık. */
export function wallIntegrity(f: Fortification): number {
  return (
    f.wallLevel * (BUILDINGS.wall.integrityPerLevel ?? 0) +
    f.keepLevel * (BUILDINGS.keep.integrityPerLevel ?? 0)
  );
}

/**
 * Bir kuşatma round'unda sura verilen hasar.
 *
 * Kuşatma birimi taşımayan ordu surla ancak sembolik biçimde uğraşabilir
 * (`noSiegeEquipmentPenalty`) — GDD §7'deki "doğru asker *tipini* göndermek,
 * sadece asker *sayısını* göndermekten önemlidir" kuralının sayısal karşılığı.
 */
export function siegeDamagePerRound(params: {
  army: ArmyComposition;
  terrain: TerrainType;
  moatLevel: number;
}): number {
  const siegePower = armySiegePower(params.army);
  const terrainMult = TERRAIN[params.terrain].siegeEffectiveness;
  const moatReduction = clamp(
    1 - params.moatLevel * BALANCE.combat.moatSiegeReductionPerLevel,
    0.3,
    1,
  );

  if (siegePower <= 0) {
    // Kuşatma ekipmanı yok: sadece çıplak elle sur zorlanır.
    let rawAttack = 0;
    for (const [type, count] of Object.entries(params.army) as [UnitType, number][]) {
      if (count > 0) rawAttack += UNITS[type].attack * count;
    }
    return rawAttack * BALANCE.combat.noSiegeEquipmentPenalty * terrainMult * moatReduction;
  }

  return siegePower * terrainMult * moatReduction;
}

/** Bu ordunun bu tahkimatı düşürmesi kaç round sürer (tahmini). */
export function estimatedSiegeRounds(params: {
  army: ArmyComposition;
  fortification: Fortification;
  terrain: TerrainType;
}): number {
  const damage = siegeDamagePerRound({
    army: params.army,
    terrain: params.terrain,
    moatLevel: params.fortification.moatLevel,
  });
  if (damage <= 0) return Number.POSITIVE_INFINITY;
  return Math.ceil(wallIntegrity(params.fortification) / damage);
}

/** Çatışma anlık akın mı yoksa çok-tick'li kuşatma mı olacak (GDD §8.1/§8.2). */
export function isSiegeEngagement(params: {
  army: ArmyComposition;
  wallLevel: number;
  intent: string;
}): boolean {
  if (params.intent === 'raid' || params.intent === 'scout') return false;
  return (
    armyUnitCount(params.army) >= BALANCE.combat.siegeArmySizeThreshold ||
    params.wallLevel >= BALANCE.combat.siegeWallLevelThreshold
  );
}

// ---------------------------------------------------------------------------
// Savaş çözümlemesi (GDD §8.3)
// ---------------------------------------------------------------------------

export interface BattleSide {
  army: ArmyComposition;
  tactic: Tactic;
  popularity: number;
  chapelLevels: number[];
  /** Yalnızca saldıran için: kat edilen mesafe. */
  distanceTiles?: number;
}

export interface BattleInput {
  attacker: BattleSide;
  defender: BattleSide;
  terrain: TerrainType;
  fortification?: Fortification;
  /** Kuşatma round'u mu, tek seferlik akın mı. */
  mode: 'raid' | 'siege_round';
  /** Savunanın yağmalanabilir deposu. */
  defenderStock?: ResourceLedger;
  /** 0..1 arası deterministik rastgelelik kaynağı (test edilebilirlik için dışarıdan verilir). */
  randomRoll?: number;
}

export interface BattlePowers {
  attackPower: number;
  defensePower: number;
  attackerShare: number;
}

/** Saldıran ordudaki süvari oranı — savunanın hangi savunma değerini kullanacağını belirler. */
function cavalryShare(army: ArmyComposition): number {
  const cavalry: UnitType[] = ['knight', 'light_cavalry', 'horse_archer'];
  let total = 0;
  let mounted = 0;
  for (const [type, count] of Object.entries(army) as [UnitType, number][]) {
    if (!count) continue;
    total += count;
    if (cavalry.includes(type)) mounted += count;
  }
  return total <= 0 ? 0 : mounted / total;
}

/** Saldırı ve savunma güçlerini hesaplar. */
export function computeBattlePowers(input: BattleInput): BattlePowers {
  const terrain = TERRAIN[input.terrain];
  const atkTactic = BALANCE.tactics[input.attacker.tactic];
  const defTactic = BALANCE.tactics[input.defender.tactic];

  const atkMorale = moraleMultiplier(input.attacker.popularity, input.attacker.chapelLevels);
  const defMorale = moraleMultiplier(input.defender.popularity, input.defender.chapelLevels);
  const fatigue = fatigueMultiplier(input.attacker.distanceTiles ?? 0);

  // Saldırı gücü = birim istatistikleri × taktik × moral × yorgunluk
  let rawAttack = 0;
  for (const [type, count] of Object.entries(input.attacker.army) as [UnitType, number][]) {
    if (count > 0) rawAttack += UNITS[type].attack * count;
  }
  const attackPower = rawAttack * atkTactic.attack * atkMorale * fatigue;

  // Savunma gücü = birim istatistikleri × taktik × moral × arazi + tahkimat
  const mountedShare = cavalryShare(input.attacker.army);
  let rawDefense = 0;
  for (const [type, count] of Object.entries(input.defender.army) as [UnitType, number][]) {
    if (count <= 0) continue;
    const def = UNITS[type];
    // Savunanın etkin savunması, saldıranın süvari oranına göre iki değer arasında gezer.
    const effective = def.defense * (1 - mountedShare) + def.defenseVsCavalry * mountedShare;
    rawDefense += effective * count;
  }

  let terrainDefense = terrain.defenseMultiplier;
  // Arazinin desteklediği taktik seçildiyse arazi çarpanı bir kez daha uygulanır.
  if (terrain.favoredTactic && input.defender.tactic === terrain.favoredTactic) {
    terrainDefense *= terrain.defenseMultiplier;
  }

  let defensePower = rawDefense * defTactic.defense * defMorale * terrainDefense;
  if (input.fortification) defensePower += fortificationBonus(input.fortification);

  // Dar boğaz: saldıranın sayı üstünlüğü arazi tarafından kısıtlanır.
  let effectiveAttack = attackPower;
  if (terrain.chokepointFactor < 1 && defensePower > 0 && attackPower > defensePower) {
    const advantage = attackPower / defensePower - 1;
    effectiveAttack = defensePower * (1 + advantage * terrain.chokepointFactor);
  }

  const denom = effectiveAttack + defensePower;
  const attackerShare = denom <= 0 ? 0.5 : effectiveAttack / denom;

  return { attackPower: effectiveAttack, defensePower, attackerShare };
}

/**
 * Kayıp oranlarını güç payından türetir.
 *
 * `share = 0.5` (tam denge) iken iki taraf da `baseRate` kadar kaybeder;
 * üstünlük arttıkça kaybedenin kaybı üstel olarak büyür, kazananınki küçülür.
 */
export function casualtyRates(
  attackerShare: number,
  mode: 'raid' | 'siege_round',
): { attacker: number; defender: number } {
  const base =
    mode === 'raid' ? BALANCE.combat.raidCasualtyRate : BALANCE.combat.baseCasualtyRate;
  const exp = BALANCE.combat.powerRatioExponent;
  const r = clamp(attackerShare, 0.01, 0.99);
  return {
    attacker: clamp(base * Math.pow(2 * (1 - r), exp), 0, 1),
    defender: clamp(base * Math.pow(2 * r, exp), 0, 1),
  };
}

/** Kayıpları ordu içinde birim tiplerine dağıtır. */
function distributeCasualties(army: ArmyComposition, rate: number): ArmyComposition {
  const losses: ArmyComposition = {};
  for (const [type, count] of Object.entries(army) as [UnitType, number][]) {
    if (!count || count <= 0) continue;
    const def = UNITS[type];
    // Kuşatma makineleri ve destek birimleri hattın gerisindedir, daha az kayıp verir.
    let typeRate = rate;
    if (def.category === 'siege') typeRate *= 0.5;
    if (type === 'engineer') typeRate *= 0.5;
    // Casus ve suikastçı garnizon çatışmasına katılmaz.
    if (type === 'spy' || type === 'assassin') typeRate = 0;
    const lost = Math.min(count, Math.round(count * typeRate));
    if (lost > 0) losses[type] = lost;
  }
  return losses;
}

/** Kazananın alabileceği yağma. */
function computePlunder(
  army: ArmyComposition,
  losses: ArmyComposition,
  defenderStock: ResourceLedger | undefined,
): ResourceBundle {
  if (!defenderStock) return {};
  const survivors: ArmyComposition = {};
  for (const [type, count] of Object.entries(army) as [UnitType, number][]) {
    survivors[type] = Math.max(0, (count ?? 0) - (losses[type] ?? 0));
  }
  let capacity = 0;
  for (const [type, count] of Object.entries(survivors) as [UnitType, number][]) {
    if (count > 0) capacity += UNITS[type].carryCapacity * count;
  }
  if (capacity <= 0) return {};

  // Yağmalanabilir kalemler: ana kaynaklar (ara ürünler taşınmaz).
  const lootable: Resource[] = ['gold', 'food', 'stone', 'wood', 'iron', 'ale'];
  const available = lootable.map((r) => ({
    resource: r,
    amount: Math.max(0, (defenderStock[r] ?? 0) * BALANCE.combat.maxPlunderRatio),
  }));
  const totalAvailable = available.reduce((s, a) => s + a.amount, 0);
  if (totalAvailable <= 0) return {};

  const takeRatio = Math.min(1, capacity / totalAvailable);
  const plunder: ResourceBundle = {};
  for (const { resource, amount } of available) {
    const take = Math.floor(amount * takeRatio);
    if (take > 0) plunder[resource] = take;
  }
  return plunder;
}

/** Bir çatışmayı (akın ya da kuşatma round'u) çözer. */
export function resolveBattle(input: BattleInput): {
  attackPower: number;
  defensePower: number;
  attackerShare: number;
  attackerWon: boolean;
  casualties: { attacker: ArmyComposition; defender: ArmyComposition };
  plunder: ResourceBundle;
  wallDamage: number;
} {
  const powers = computeBattlePowers(input);
  const rates = casualtyRates(powers.attackerShare, input.mode);
  const terrain = TERRAIN[input.terrain];

  // Arazi yıpratması: kıraç/dağlık arazide uzun kuşatma saldıranı eritir.
  const attritionRate =
    input.mode === 'siege_round' ? terrain.attackerAttritionPerRound : 0;

  const attackerLosses = distributeCasualties(
    input.attacker.army,
    clamp(rates.attacker + attritionRate, 0, 1),
  );
  const defenderLosses = distributeCasualties(input.defender.army, rates.defender);

  const attackerWon = powers.attackerShare > 0.5;

  const plunder = attackerWon
    ? computePlunder(input.attacker.army, attackerLosses, input.defenderStock)
    : {};

  const wallDamage =
    input.mode === 'siege_round' && input.fortification
      ? siegeDamagePerRound({
          army: input.attacker.army,
          terrain: input.terrain,
          moatLevel: input.fortification.moatLevel,
        })
      : 0;

  return {
    attackPower: powers.attackPower,
    defensePower: powers.defensePower,
    attackerShare: powers.attackerShare,
    attackerWon,
    casualties: { attacker: attackerLosses, defender: defenderLosses },
    plunder,
    wallDamage,
  };
}

// ---------------------------------------------------------------------------
// Nakliye kervanı (GDD §9)
// ---------------------------------------------------------------------------

export function caravanTravelSeconds(distanceTiles: number): number {
  return Math.max(60, Math.round(BALANCE.caravan.secondsPerTile * Math.max(1, distanceTiles)));
}

/** Bir depoyu boşaltmak için kaç kervan seferi gerekir (§9). */
export function caravanTripsNeeded(totalAmount: number): number {
  return Math.ceil(Math.max(0, totalAmount) / BALANCE.caravan.capacityPerTrip);
}

export function caravanLoad(requested: number): number {
  return Math.min(Math.max(0, requested), BALANCE.caravan.capacityPerTrip);
}

// ---------------------------------------------------------------------------
// İtibar (GDD §10.3)
// ---------------------------------------------------------------------------

/** İtibar zamanla nötre doğru çok yavaş kayar — eski günahlar sonsuza kadar sürmez. */
export function driftReputation(current: number, hours: number): number {
  const R = BALANCE.diplomacy.reputation;
  const step = (R.driftPerDay * hours) / 24;
  if (current < R.driftTarget) return Math.min(R.driftTarget, current + step);
  if (current > R.driftTarget) return Math.max(R.driftTarget, current - step);
  return current;
}

export function applyReputationDelta(current: number, delta: number): number {
  return clamp(current + delta, 0, 100);
}

/** Bir teklifin karşı tarafça değerlendirilmesinde itibarın etkisi (0..1 güven katsayısı). */
export function reputationTrustFactor(reputation: number): number {
  return clamp(reputation / 100, 0, 1);
}

// ---------------------------------------------------------------------------
// Kral–General ilişkisi (GDD §14.5)
// ---------------------------------------------------------------------------

export interface RiskAssessmentInput {
  action: string;
  /** Aksiyonun toplam altın/kaynak maliyeti. */
  estimatedCost: number;
  treasuryGold: number;
  /** Sefere çıkarılan birim sayısı ve garnizonun toplamı. */
  unitsCommitted: number;
  garrisonSize: number;
  intent?: string;
  proposalType?: string;
}

export interface RiskAssessment {
  tier: 'routine' | 'major';
  reasons: string[];
  /** 0..1: krallığı ne kadar riske attığı. Sadakat kaybı buna göre ölçeklenir. */
  severity: number;
}

/**
 * Bir aksiyonun "rutin" mi "büyük/riskli" mi olduğunu belirler.
 *
 * Bu karar backend'de verilir, LLM'e bırakılmaz — General'ın kendini "bu rutin"
 * diye ikna edip onay adımını atlaması mümkün olmamalı (§15.5).
 */
export function assessRisk(input: RiskAssessmentInput): RiskAssessment {
  const T = BALANCE.general.majorDecisionThresholds;
  const reasons: string[] = [];
  let severity = 0;

  const treasuryShare =
    input.treasuryGold > 0 ? input.estimatedCost / input.treasuryGold : input.estimatedCost > 0 ? 1 : 0;
  if (treasuryShare > T.treasuryShare) {
    reasons.push(
      `Hazinenin %${Math.round(treasuryShare * 100)}'ini harcıyor (eşik %${Math.round(T.treasuryShare * 100)}).`,
    );
    severity = Math.max(severity, clamp(treasuryShare, 0, 1));
  }

  const garrisonShare =
    input.garrisonSize > 0 ? input.unitsCommitted / input.garrisonSize : input.unitsCommitted > 0 ? 1 : 0;
  if (garrisonShare > T.garrisonShare) {
    reasons.push(
      `Garnizonun %${Math.round(garrisonShare * 100)}'ini sefere çıkarıyor — kale savunmasız kalabilir.`,
    );
    severity = Math.max(severity, clamp(garrisonShare, 0, 1));
  }

  if (input.intent && (T.offensiveIntents as readonly string[]).includes(input.intent)) {
    reasons.push('Saldırı niyeti taşıyor — fiilen savaş ilanı anlamına gelir.');
    severity = Math.max(severity, 0.6);
  }

  if (
    input.proposalType &&
    (T.bindingProposals as readonly string[]).includes(input.proposalType)
  ) {
    reasons.push('Uzun vadeli bağlayıcı bir diplomatik taahhüt doğuruyor.');
    severity = Math.max(severity, 0.55);
  }

  return {
    tier: reasons.length > 0 ? 'major' : 'routine',
    reasons,
    severity,
  };
}

/** Kral ısrar edip riskli emri uygulattığında sadakat kaybı. */
export function loyaltyAfterForcedOrder(loyalty: number, severity: number): number {
  const G = BALANCE.general;
  const drop =
    severity >= 0.85
      ? G.loyaltyDropOnCatastrophicOrder
      : G.loyaltyDropOnForcedRiskyOrder * clamp(severity / 0.85, 0, 1);
  return clamp(loyalty - drop, 0, 100);
}

export function loyaltyAfterSoundOrder(loyalty: number): number {
  return clamp(loyalty + BALANCE.general.loyaltyGainOnSoundOrder, 0, 100);
}

/**
 * Düşük sadakatin davranışa etkisi. Ani bir "isyan" değil, birikimli bir güven
 * aşınması: önce gecikme, en uçta nadiren açık ret.
 */
export function generalCompliance(
  loyalty: number,
  randomRoll: number,
): { comply: boolean; delaySeconds: number; note?: string } {
  const G = BALANCE.general;
  if (loyalty < G.defiantThreshold && randomRoll < G.refusalChance) {
    return {
      comply: false,
      delaySeconds: 0,
      note: 'General emri açıkça reddetti — aranızdaki güven ciddi biçimde aşınmış durumda.',
    };
  }
  if (loyalty < G.sluggishThreshold) {
    return {
      comply: true,
      delaySeconds: G.sluggishDelaySeconds,
      note: 'General emri isteksizce kabul etti; uygulama gecikecek.',
    };
  }
  return { comply: true, delaySeconds: 0 };
}

// ---------------------------------------------------------------------------
// Channel / harita yerleşimi (GDD §16.2)
// ---------------------------------------------------------------------------

/**
 * Harita dairesel olarak dışa doğru büyür: ilk katılanlar merkeze yakın,
 * geç katılanlar çepere yerleşir. Bu, geç katılanı gelişmiş bir çekirdeğe
 * atmadığı için ayrı bir "hızlandırma" mekaniği gerektirmez.
 */
export function ringForSlot(slotIndex: number): { ring: number; indexInRing: number } {
  const C = BALANCE.channel;
  let ring = 0;
  let consumed = 0;
  for (;;) {
    const slots = ring === 0 ? 1 : C.slotsPerRingBase * ring;
    if (slotIndex < consumed + slots) {
      return { ring, indexInRing: slotIndex - consumed };
    }
    consumed += slots;
    ring += 1;
    if (ring > 500) return { ring, indexInRing: 0 };
  }
}

export function slotPosition(slotIndex: number): { x: number; y: number } {
  const C = BALANCE.channel;
  const { ring, indexInRing } = ringForSlot(slotIndex);
  if (ring === 0) return { x: 0, y: 0 };
  const slots = C.slotsPerRingBase * ring;
  const angle = (indexInRing / slots) * Math.PI * 2;
  const radius = ring * C.ringRadiusStep;
  return {
    x: Math.round(Math.cos(angle) * radius),
    y: Math.round(Math.sin(angle) * radius),
  };
}

/**
 * GDD §16.2: kalan süresi Yeni Oyuncu Koruması'ndan kısa olan channel'a
 * katılım anlamsızdır — koruma channel'dan uzun sürerdi.
 */
export function canJoinChannel(remainingHours: number): boolean {
  return remainingHours > BALANCE.protection.durationHours;
}

export { MAX_KEEP_LEVEL };
