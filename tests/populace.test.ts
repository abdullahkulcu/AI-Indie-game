import assert from "node:assert/strict";
import test from "node:test";
import { applyActions } from "../engine/actions";
import { NEED, hourlyDemand, moodState, moodTarget, rationsOf, soldierUnrestAfter, suppression } from "../engine/populace";
import { grossRates, rates, tick } from "../engine/tick";
import type { Game } from "../engine/types";

const T0 = 1_800_000_000_000;

function newGame(overrides: Partial<Game> = {}): Game {
  return {
    version: 2, kingdomName: "Demirkale", rulerName: "Alaric", channel: "Standart Sezon I", channelId: "standard",
    speed: 1, terrain: "plain", foundedAt: T0, lastTickAt: T0, protectionEndsAt: T0 + 4 * 86_400_000,
    resources: { gold: 5000, food: 5000, stone: 1000, wood: 1000, iron: 500, ale: 500 },
    population: 100, capacity: 150, popularity: 50, reputation: 50, loyalty: 75, taxRate: 15, quota: 6, quotaAt: T0,
    buildings: [
      { type: "keep", name: "Kale", category: "Yönetim", level: 1 },
      { type: "wheat_farm", name: "Buğday Tarlası", category: "Ekonomi", level: 1 },
      { type: "lumberjack", name: "Oduncu Kulübesi", category: "Ekonomi", level: 1 },
    ],
    units: { spearman: 0 }, queue: null, notices: [], provider: null, model: null, generalConnected: false,
    ...overrides,
  };
}

test("eski kayıtlarda istihkak varsayılanları uygulanır", () => {
  assert.deepEqual(rationsOf(newGame()), { food: 100, ale: 0, soldierPay: 100 });
});

test("tüketim nüfusla ve istihkakla ölçeklenir", () => {
  const demand = hourlyDemand(newGame({ population: 200, foodRation: 150 }));
  assert.equal(Math.round(demand.food * 100) / 100, Math.round(200 * NEED.food * 1.5 * 100) / 100);
});

test("bira evi biraya nihayet kaynak veriyor", () => {
  assert.equal(grossRates(newGame()).ale, 0);
  const withBrewery = newGame({ buildings: [...newGame().buildings, { type: "brewery", name: "Bira Evi", category: "Halk", level: 2 }] });
  assert.equal(grossRates(withBrewery).ale, 18);
});

test("asker maaşı altından düşülür", () => {
  const withArmy = newGame({ units: { spearman: 20 } });
  const demand = hourlyDemand(withArmy);
  assert.equal(demand.gold, 20 * NEED.soldierGold);
  assert.ok(rates(withArmy).gold < rates(newGame()).gold);
});

test("yiyecek istihkakı kesilince hedef rıza çöker", () => {
  const base = { servedAle: 0, taxRate: 15, population: 100, capacity: 150, buildings: [] };
  assert.ok(moodTarget({ ...base, servedFood: 100 }) > 45);
  assert.ok(moodTarget({ ...base, servedFood: 40 }) < 25);
  assert.ok(moodTarget({ ...base, servedFood: 0 }) < 5);
});

test("bira ve eğlence yapıları rızayı yükseltir ama açlığı telafi etmez", () => {
  const hungry = { servedFood: 30, servedAle: 0, taxRate: 15, population: 100, capacity: 150, buildings: [] };
  const withFun = { ...hungry, servedAle: 200, buildings: [{ type: "theater", level: 3 }, { type: "park", level: 3 }] };
  assert.ok(moodTarget(withFun) > moodTarget(hungry), "eğlence bir şeyler katmalı");
  assert.ok(moodTarget(withFun) < 45, "ama aç halk yine de memnun olmaz");
});

test("kalabalıklık rızayı düşürür", () => {
  const base = { servedFood: 100, servedAle: 0, taxRate: 15, capacity: 150, buildings: [] };
  assert.ok(moodTarget({ ...base, population: 149 }) < moodTarget({ ...base, population: 100 }));
});

test("mutluluk eşikleri üretimi ve nüfusu belirler", () => {
  assert.equal(moodState(80, 0).id, "content");
  assert.equal(moodState(50, 0).id, "uneasy");
  assert.equal(moodState(30, 0).id, "simmering");
  assert.equal(moodState(15, 0).id, "strike");
  assert.equal(moodState(5, 0).id, "revolt");
  assert.ok(moodState(15, 0).production < 0.5, "iş bırakma üretimi düşürmeli");
  assert.ok(moodState(5, 0).populationPerHour < 0, "isyanda halk kaçmalı");
});

test("askerler huzursuzluğu bastırır, maaşsız kalınca bastıramaz", () => {
  const paid = suppression(20, 100, 0);
  assert.ok(paid > 0);
  assert.equal(moodState(15, paid).id, "simmering", "asker iş bırakmayı bastırmalı");
  assert.ok(suppression(20, 100, 90) < paid * 0.2, "isyankâr asker bastırmaz");
});

test("maaş eksik ödendikçe asker huzursuzluğu birikir, ödenince erir", () => {
  const risen = soldierUnrestAfter(0, 0, 10);
  assert.ok(risen > 50);
  assert.ok(soldierUnrestAfter(risen, 100, 5) < risen);
});

test("iş bırakma üretimi gerçekten düşürür", () => {
  const calm = newGame({ popularity: 80 });
  const striking = newGame({ popularity: 15 });
  assert.ok(rates(striking).wood < rates(calm).wood * 0.5);
});

test("aç krallıkta nüfus azalır", () => {
  const starving = newGame({ popularity: 5, resources: { ...newGame().resources, food: 0 } });
  const after = tick(starving, T0 + 3_600_000);
  assert.ok(after.population < starving.population, "isyanda halk göç etmeli");
});

test("maaşsız ordu firar eder", () => {
  const unpaid = newGame({ units: { spearman: 40 }, soldierUnrest: 70, soldierPay: 0, resources: { ...newGame().resources, gold: 0 } });
  const after = tick(unpaid, T0 + 3_600_000);
  assert.ok(after.units.spearman < 40, "firar orduyu küçültmeli");
});

test("istihkak emri uygulanır ve kota harcar", () => {
  const before = newGame();
  const { game, results } = applyActions(before, [{ name: "set_food_ration", arguments: { percent: 140 } }], T0);
  assert.match(results[0], /^✓/);
  assert.equal(game.foodRation, 140);
  assert.equal(game.quota, before.quota - 1);
});

test("açlık sınırına inen istihkak teyitsiz uygulanmaz", () => {
  const blockedRun = applyActions(newGame(), [{ name: "set_food_ration", arguments: { percent: 30 } }], T0);
  assert.match(blockedRun.results[0], /^✕/);
  const confirmed = applyActions(newGame(), [{ name: "set_food_ration", arguments: { percent: 30, confirmed_risk: true } }], T0);
  assert.match(confirmed.results[0], /^✓/);
  assert.equal(confirmed.game.foodRation, 30);
});

test("bira evi olmadan bira istihkakı verilemez", () => {
  const { results } = applyActions(newGame(), [{ name: "set_ale_ration", arguments: { percent: 100 } }], T0);
  assert.match(results[0], /Bira Evi kurulmalı/);
});

test("asker maaşını kesmek teyit ister", () => {
  const { results } = applyActions(newGame({ units: { spearman: 10 } }), [{ name: "set_soldier_pay", arguments: { percent: 20 } }], T0);
  assert.match(results[0], /firara ve isyana/);
});

test("halk durumu değişince deftere bildirim düşer", () => {
  const collapsing = newGame({ popularity: 30, foodRation: 0, resources: { ...newGame().resources, food: 0 } });
  const after = tick(collapsing, T0 + 6 * 3_600_000);
  assert.ok(after.notices.some(notice => notice.kind === "HALK" || notice.kind === "AÇLIK"), "Kral haberdar edilmeli");
});
