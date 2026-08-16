/**
 * Formül birim testleri.
 *
 * Odak, GDD'nin sayı verdiği ya da bir davranışı açıkça vaat ettiği yerler:
 * maden taper eğrisi (§4.1), üretim darboğazı (§4), popülerlik/nüfus (§6),
 * kuşatma birimi olmadan sur düşürememe (§7/§8.2), yorgunluk (§8.3), emir
 * kotası rollover'ı (§14.4) ve kademeli karar eşikleri (§14.5).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

// Testler derlenmiş paketi tüketiyor: tüketicilerin gördüğü yüzeyin ta kendisi
// sınanmış oluyor, `src` içindeki dosya düzeni de serbest kalıyor.
import {
  advancePopularity,
  advancePopulation,
  armyPopulationCost,
  armySecondsPerTile,
  assessRisk,
  BALANCE,
  buildingCostAtLevel,
  caravanTripsNeeded,
  casualtyRates,
  computeProduction,
  decreeQuotaCap,
  deepExcavationCost,
  emptyLedger,
  estimatedSiegeRounds,
  fatigueMultiplier,
  festivalBoost,
  fortificationBonus,
  isSiegeEngagement,
  KEEP_LEVELS,
  MAX_KEEP_LEVEL,
  mineProductionMultiplier,
  moraleMultiplier,
  popularityTarget,
  refillDecreeQuota,
  resolveBattle,
  slotPosition,
  UNITS,
  wallIntegrity,
  type ProductionBuilding,
} from '../dist/index.js';

// ---------------------------------------------------------------------------
// Maden tükenmesi (§4.1)
// ---------------------------------------------------------------------------

test('maden rezervi %20 üstündeyken tam kapasite üretir', () => {
  assert.equal(mineProductionMultiplier(50_000, 100_000), 1);
  assert.equal(mineProductionMultiplier(20_000, 100_000), 1);
});

test('taper eğrisi: rezerv %10\'a düşünce üretim %50\'ye iner', () => {
  // GDD §4.1'in verdiği somut örnek.
  assert.equal(mineProductionMultiplier(10_000, 100_000), 0.5);
  assert.equal(mineProductionMultiplier(0, 100_000), 0);
});

test('derin kazı maliyeti her kullanımda 1.5x artar', () => {
  assert.equal(deepExcavationCost(0), 500);
  assert.equal(deepExcavationCost(1), 750);
  assert.equal(deepExcavationCost(2), 1125);
});

// ---------------------------------------------------------------------------
// Üretim zinciri ve darboğaz (§4)
// ---------------------------------------------------------------------------

function makeBuilding(
  id: string,
  type: ProductionBuilding['type'],
  level: number,
): ProductionBuilding {
  return { id, type, level, terrain: 'plains' };
}

test('değirmen kapasitesi tarlanın altındaysa darboğaz olarak raporlanır', () => {
  // GDD §4'ün örneği: tarla 100/saat üretirken değirmen 60/saat işleyebiliyorsa
  // değirmen darboğazdır. Burada tersini kuruyoruz: değirmen çok, buğday az.
  const result = computeProduction({
    buildings: [makeBuilding('mill-1', 'mill', 4)],
    stock: emptyLedger(),
    capacity: 100_000,
    hours: 1,
    population: 100,
    availableWorkers: 1000,
    taxRate: 20,
  });

  const bottleneck = result.bottlenecks.find((b) => b.buildingId === 'mill-1');
  assert.ok(bottleneck, 'değirmen darboğaz olarak işaretlenmeli');
  assert.equal(bottleneck.reason, 'input_shortage');
  assert.equal(bottleneck.limitingResource, 'wheat');
  assert.equal(result.produced.flour ?? 0, 0, 'buğday yoksa un üretilemez');
});

test('zincir aynı pencerede ham → ara → nihai akar', () => {
  const result = computeProduction({
    buildings: [
      makeBuilding('farm', 'wheat_farm', 3),
      makeBuilding('mill', 'mill', 3),
      makeBuilding('bakery', 'bakery', 3),
    ],
    stock: emptyLedger(),
    capacity: 100_000,
    hours: 1,
    population: 50,
    availableWorkers: 1000,
    taxRate: 20,
  });

  // Tarla buğday üretti, değirmen aynı tick'te onu una çevirdi, fırın ekmeğe.
  assert.ok((result.produced.wheat ?? 0) > 0);
  assert.ok((result.produced.flour ?? 0) > 0);
  assert.ok((result.produced.food ?? 0) > 0);
});

test('işçi yetersizliği tüm üretimi orantılı olarak kısar', () => {
  const buildings = [makeBuilding('farm', 'wheat_farm', 4)];
  const full = computeProduction({
    buildings,
    stock: emptyLedger(),
    capacity: 100_000,
    hours: 1,
    population: 100,
    availableWorkers: 1000,
    taxRate: 0,
  });
  const starved = computeProduction({
    buildings,
    stock: emptyLedger(),
    capacity: 100_000,
    hours: 1,
    population: 100,
    availableWorkers: 8, // gereken 16 işçinin yarısı
    taxRate: 0,
  });

  assert.equal(starved.workerUtilization, 0.5);
  assert.ok((starved.produced.wheat ?? 0) < (full.produced.wheat ?? 0));
});

test('depo dolduğunda üretim ziyan olur', () => {
  const stock = emptyLedger();
  stock.wood = 500;
  const result = computeProduction({
    buildings: [makeBuilding('wc', 'woodcutter', 5)],
    stock,
    capacity: 500,
    hours: 5,
    population: 20,
    availableWorkers: 1000,
    taxRate: 0,
  });
  assert.ok((result.wasted.wood ?? 0) > 0, 'kapasite aşımı ziyan olarak raporlanmalı');
  assert.equal(result.finalStock.wood, 500);
});

// ---------------------------------------------------------------------------
// Popülerlik ve nüfus (§6)
// ---------------------------------------------------------------------------

test('yüksek vergi popülerliği düşürür', () => {
  const base = {
    foodBalancePerHour: 5,
    population: 100,
    aleStock: 0,
    cheeseStock: 0,
    chapelLevels: [],
    townSquareLevels: [],
    recentDefeats: 0,
    recentDefenseVictories: 0,
    recentAttackVictories: 0,
    underSiege: false,
    festivalBonus: 0,
  };
  const low = popularityTarget({ ...base, taxRate: 10 });
  const high = popularityTarget({ ...base, taxRate: 80 });
  assert.ok(high < low, 'yüksek vergi hedef popülerliği aşağı çekmeli');
});

test('yiyecek açığı popülerliği sert cezalandırır', () => {
  const base = {
    taxRate: 20,
    population: 100,
    aleStock: 0,
    cheeseStock: 0,
    chapelLevels: [],
    townSquareLevels: [],
    recentDefeats: 0,
    recentDefenseVictories: 0,
    recentAttackVictories: 0,
    underSiege: false,
    festivalBonus: 0,
  };
  const surplus = popularityTarget({ ...base, foodBalancePerHour: 10 });
  const deficit = popularityTarget({ ...base, foodBalancePerHour: -10 });
  assert.ok(deficit < surplus - 20, 'açık, fazlaya göre belirgin biçimde kötü olmalı');
});

test('popülerlik hedefe anında sıçramaz', () => {
  const next = advancePopularity(50, 100, 1);
  assert.ok(next > 50 && next < 70, `tek saatte kademeli artmalı, oldu: ${next}`);
});

test('yiyecek açığı varken nüfus büyümez', () => {
  const grown = advancePopulation({
    population: 100,
    capacity: 500,
    popularity: 90,
    foodBalancePerHour: -1,
    hours: 10,
  });
  assert.equal(grown, 100);
});

test('düşük popülerlikte nüfus göç eder', () => {
  const shrunk = advancePopulation({
    population: 100,
    capacity: 500,
    popularity: 10,
    foodBalancePerHour: 10,
    hours: 10,
  });
  assert.ok(shrunk < 100);
});

test('şenlik azalan getiri verir', () => {
  const first = festivalBoost(0);
  const second = festivalBoost(1);
  const third = festivalBoost(2);
  assert.equal(first, BALANCE.festival.basePopularityBoost);
  assert.ok(second < first && third < second, 'her tekrar etkisini yarıya indirmeli');
});

// ---------------------------------------------------------------------------
// Savaş ve kuşatma (§7, §8)
// ---------------------------------------------------------------------------

test('sefer hızı ordudaki en yavaş birimin hızıdır', () => {
  const fast = armySecondsPerTile({ light_cavalry: 10 });
  const withCatapult = armySecondsPerTile({ light_cavalry: 10, catapult: 1 });
  assert.equal(fast, UNITS.light_cavalry.secondsPerTile);
  assert.equal(withCatapult, UNITS.catapult.secondsPerTile);
  assert.ok(withCatapult > fast, 'tek bir mancınık tüm orduyu yavaşlatmalı');
});

test('şövalye nüfustan üç kat çalar', () => {
  assert.equal(armyPopulationCost({ knight: 10 }), 30);
  // Kiralık asker nüfus tüketmeyen tek istisna (§7).
  assert.equal(armyPopulationCost({ mercenary: 100 }), 0);
});

test('kuşatma birimi olmayan ordu yüksek seviyeli suru makul sürede düşüremez', () => {
  const fortification = {
    keepLevel: 5,
    wallLevel: 5,
    towerLevels: [4, 4],
    moatLevel: 2,
    gateLevel: 2,
  };

  const withoutSiege = estimatedSiegeRounds({
    army: { swordsman: 200 },
    fortification,
    terrain: 'plains',
  });
  const withSiege = estimatedSiegeRounds({
    army: { swordsman: 200, trebuchet: 4, engineer: 4 },
    fortification,
    terrain: 'plains',
  });

  assert.ok(
    withoutSiege > BALANCE.combat.siegeMaxRounds,
    `kuşatmasız ordu sınırı aşmalı, oldu: ${withoutSiege}`,
  );
  assert.ok(withSiege < withoutSiege, 'trebuşet süreyi belirgin kısaltmalı');
  assert.ok(withSiege <= BALANCE.combat.siegeMaxRounds, 'doğru ordu ile kuşatma mümkün olmalı');
});

test('sur ve kule seviyesi savunma bonusunu birlikte büyütür', () => {
  const bare = fortificationBonus({ keepLevel: 3, wallLevel: 0, towerLevels: [], moatLevel: 0, gateLevel: 0 });
  const walled = fortificationBonus({ keepLevel: 3, wallLevel: 4, towerLevels: [], moatLevel: 0, gateLevel: 0 });
  const walledWithTowers = fortificationBonus({
    keepLevel: 3,
    wallLevel: 4,
    towerLevels: [3, 3],
    moatLevel: 0,
    gateLevel: 0,
  });

  assert.ok(walled > bare);
  // Sinerji: kuleler sur varken tek başlarına olduğundan daha çok katkı yapar.
  const towersAlone = fortificationBonus({
    keepLevel: 3,
    wallLevel: 0,
    towerLevels: [3, 3],
    moatLevel: 0,
    gateLevel: 0,
  });
  assert.ok(walledWithTowers - walled > towersAlone - bare);
});

test('sur yokken de kale savunmaya katkı yapar', () => {
  // GDD §8.3 formülü birebir çarpım yazıyor; sur 0 iken bonusun tamamen
  // sıfırlanmaması bilinçli bir uyarlama.
  const bonus = fortificationBonus({ keepLevel: 4, wallLevel: 0, towerLevels: [], moatLevel: 0, gateLevel: 0 });
  assert.ok(bonus > 0);
});

test('yorgunluk yalnızca eşik ötesinde devreye girer', () => {
  assert.equal(fatigueMultiplier(BALANCE.fatigue.freeDistanceTiles), 1);
  const far = fatigueMultiplier(40);
  assert.ok(far < 1 && far >= BALANCE.fatigue.minMultiplier);
});

test('moral popülerlikten beslenir', () => {
  assert.ok(moraleMultiplier(0) < moraleMultiplier(100));
  assert.ok(moraleMultiplier(0) >= BALANCE.morale.min);
});

test('kayıp oranları güç dengesinde simetriktir', () => {
  const even = casualtyRates(0.5, 'raid');
  assert.equal(even.attacker, even.defender);

  const dominant = casualtyRates(0.9, 'raid');
  assert.ok(dominant.defender > dominant.attacker * 5, 'ezici üstünlük tek taraflı olmalı');
});

test('savunan tahkimatlı ve arazi avantajlıyken sayıca üstün saldırganı durdurabilir', () => {
  const outcome = resolveBattle({
    attacker: {
      army: { swordsman: 100 },
      tactic: 'frontal',
      popularity: 60,
      chapelLevels: [],
      distanceTiles: 30,
    },
    defender: {
      army: { spearman: 40, crossbowman: 20 },
      tactic: 'withdraw_to_keep',
      popularity: 80,
      chapelLevels: [2],
    },
    terrain: 'pass',
    fortification: { keepLevel: 4, wallLevel: 4, towerLevels: [3], moatLevel: 2, gateLevel: 2 },
    mode: 'siege_round',
  });

  assert.equal(outcome.attackerWon, false, 'dar boğaz + sur savunanı ayakta tutmalı');
  // Kuşatma ekipmanı yok: sura verilen hasar sembolik kalmalı.
  assert.ok(outcome.wallDamage < wallIntegrity({
    keepLevel: 4, wallLevel: 4, towerLevels: [3], moatLevel: 2, gateLevel: 2,
  }) / BALANCE.combat.siegeMaxRounds);
});

test('akın kuşatmaya dönüşmez, büyük saldırı dönüşür', () => {
  assert.equal(isSiegeEngagement({ army: { light_cavalry: 200 }, wallLevel: 5, intent: 'raid' }), false);
  assert.equal(isSiegeEngagement({ army: { swordsman: 5 }, wallLevel: 2, intent: 'attack' }), true);
  assert.equal(isSiegeEngagement({ army: { swordsman: 5 }, wallLevel: 0, intent: 'attack' }), false);
});

// ---------------------------------------------------------------------------
// Kervan (§9)
// ---------------------------------------------------------------------------

test('kervan kapasitesini aşan depo birden fazla sefer gerektirir', () => {
  assert.equal(caravanTripsNeeded(BALANCE.caravan.capacityPerTrip), 1);
  assert.equal(caravanTripsNeeded(BALANCE.caravan.capacityPerTrip + 1), 2);
  assert.equal(caravanTripsNeeded(1000), Math.ceil(1000 / BALANCE.caravan.capacityPerTrip));
});

// ---------------------------------------------------------------------------
// Emir kotası (§14.4)
// ---------------------------------------------------------------------------

test('kota Kale seviyesine göre ölçeklenir', () => {
  assert.equal(KEEP_LEVELS[0]?.decreeQuotaPerHour, 2);
  assert.equal(KEEP_LEVELS[2]?.decreeQuotaPerHour, 3);
  assert.equal(KEEP_LEVELS[4]?.decreeQuotaPerHour, 4);
  assert.equal(MAX_KEEP_LEVEL, 6);
});

test('kullanılmayan kota devreder ama 2 saatlik tavanı aşamaz', () => {
  const cap = decreeQuotaCap(3); // 3/saat × 2 saat = 6
  assert.equal(cap, 6);

  const afterOneHour = refillDecreeQuota({ current: 0, keepLevel: 3, hoursElapsed: 1 });
  assert.equal(afterOneHour, 3);

  const afterTenHours = refillDecreeQuota({ current: 0, keepLevel: 3, hoursElapsed: 10 });
  assert.equal(afterTenHours, cap, 'sonsuz biriktirme engellenmiş olmalı');
});

// ---------------------------------------------------------------------------
// Kademeli karar (§14.5)
// ---------------------------------------------------------------------------

test('saldırı niyeti her zaman büyük karardır', () => {
  const risk = assessRisk({
    action: 'move_army',
    estimatedCost: 0,
    treasuryGold: 100_000,
    unitsCommitted: 1,
    garrisonSize: 10_000,
    intent: 'attack',
  });
  assert.equal(risk.tier, 'major');
});

test('garnizonun büyük kısmını sefere çıkarmak onay gerektirir', () => {
  const risk = assessRisk({
    action: 'move_army',
    estimatedCost: 0,
    treasuryGold: 100_000,
    unitsCommitted: 90,
    garrisonSize: 100,
    intent: 'raid',
  });
  assert.equal(risk.tier, 'major');
  assert.ok(risk.severity > 0.6);
});

test('küçük rutin harcama onay gerektirmez', () => {
  const risk = assessRisk({
    action: 'build_structure',
    estimatedCost: 50,
    treasuryGold: 10_000,
    unitsCommitted: 0,
    garrisonSize: 100,
  });
  assert.equal(risk.tier, 'routine');
  assert.equal(risk.reasons.length, 0);
});

// ---------------------------------------------------------------------------
// Bina eğrileri ve harita yerleşimi
// ---------------------------------------------------------------------------

test('bina maliyeti seviyeyle üstel büyür', () => {
  const l1 = buildingCostAtLevel('quarry', 1).gold ?? 0;
  const l2 = buildingCostAtLevel('quarry', 2).gold ?? 0;
  const l3 = buildingCostAtLevel('quarry', 3).gold ?? 0;
  assert.ok(l2 > l1 && l3 - l2 > l2 - l1, 'artış hızlanmalı');
});

test('kale maliyeti GDD §5.1 tablosundan okunur', () => {
  const l2 = buildingCostAtLevel('keep', 2);
  assert.deepEqual(l2, KEEP_LEVELS[1]?.cost);
});

test('harita dışa doğru büyür: geç katılan çeperde başlar', () => {
  const first = slotPosition(0);
  const later = slotPosition(50);
  const radiusOf = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);
  assert.equal(radiusOf(first), 0, 'ilk katılan merkezde');
  assert.ok(radiusOf(later) > radiusOf(slotPosition(3)), 'sonraki katılanlar dışta');
});
