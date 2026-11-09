import assert from "node:assert/strict";
import test from "node:test";
import { applyActions } from "../engine/actions";
import { hourlyDemand } from "../engine/populace";
import { tick } from "../engine/tick";
import type { Game } from "../engine/types";
import { armyExperience, armyManpower, armyUpkeep, experienceOf, garrisonDefense, isTrainableUnit, recruitUnitExperience, rewardRaidExperience, survivorUnitExperience, trainingDurationMs, unitCatalog, unitCostFor, unitOf } from "../engine/units";

const T0 = 1_800_000_000_000;

function game(overrides: Partial<Game> = {}): Game {
  return {
    version: 2, kingdomName: "Demirkale", rulerName: "Alaric", channel: "Standart", channelId: "standard",
    speed: 1, terrain: "plain", foundedAt: T0, lastTickAt: T0, protectionEndsAt: T0 + 86_400_000,
    resources: { gold: 5_000, food: 5_000, stone: 500, wood: 500, iron: 500, ale: 100 },
    population: 100, capacity: 150, popularity: 50, reputation: 50, loyalty: 75, taxRate: 15, quota: 0, quotaAt: T0,
    buildings: [
      { type: "keep", name: "Kale", category: "Yönetim", level: 3 },
      { type: "barracks", name: "Kışla", category: "Askerî", level: 3 },
      { type: "wheat_farm", name: "Buğday Tarlası", category: "Ekonomi", level: 1 },
    ],
    units: { spearman: 0 }, queue: null, notices: [], provider: null, model: null, generalConnected: false,
    ...overrides,
  };
}

test("birlik kataloğu çekirdek türleri, kiralık birliği ve Mızrakçı uyumluluğunu korur", () => {
  assert.deepEqual(unitCatalog.map(unit => unit.type), ["spearman", "swordsman", "archer", "cavalry", "siege_team", "mercenary"]);
  assert.deepEqual(unitCostFor("spearman", 1), { gold: 8, food: 10, iron: 1 });
  assert.equal(trainingDurationMs("spearman", 1, 1), 1_200_000);
  assert.equal(isTrainableUnit(unitOf("mercenary")!), false, "Kiralık Birlik kışlada üretilemez");
});

test("kiralık birlik eğitim emriyle üretilemez", () => {
  const result = applyActions(game(), [{ name: "train_unit", arguments: { unit_type: "mercenary", count: 5 } }], T0);
  assert.equal(result.game.trainingQueue, undefined);
  assert.match(result.results[0] ?? "", /Kiralık Birlik yalnız müzakereyle gelir/);
});

test("süvari ve kuşatma ekibi sayıyla değil insan gücüyle nüfustan ayrılır", () => {
  const units = { spearman: 3, cavalry: 2, siege_team: 1 };
  assert.equal(armyManpower(units), 11);
  assert.equal(Number(armyUpkeep(units).gold.toFixed(2)), 3.35);
  assert.equal(armyUpkeep(units).food, .365);
  const demand = hourlyDemand(game({ units }));
  assert.equal(Number(demand.gold.toFixed(2)), 3.35);
  assert.equal(Number(demand.food.toFixed(3)), 3.865);
});

test("eğitim inşaattan ayrı kuyrukta başlar ve bitince birlik garnizona katılır", () => {
  const construction = { kind: "building" as const, type: "wall", name: "Sur Sv.1", targetLevel: 1, startedAt: T0, completesAt: T0 + 9_000_000 };
  const started = applyActions(game({ queue: construction }), [{ name: "train_unit", arguments: { unit_type: "archer", count: 2 } }], T0).game;
  assert.equal(started.queue?.name, construction.name, "inşaat sırası korunmalı");
  assert.equal(started.trainingQueue?.type, "archer");
  assert.equal(started.population, 98);
  const finished = tick(started, started.trainingQueue!.completesAt);
  assert.equal(finished.units.archer, 2);
  assert.equal(finished.trainingQueue, null);
  assert.equal(finished.queue?.name, construction.name, "eğitim inşaatı bitirmemeli");
});

test("Kışla seviyesi tür kilidini uygular", () => {
  const lowBarracks = game({ buildings: game().buildings.map(building => building.type === "barracks" ? { ...building, level: 1 } : building) });
  const result = applyActions(lowBarracks, [{ name: "train_unit", arguments: { unit_type: "cavalry", count: 1 } }], T0);
  assert.match(result.results[0], /Kışla Sv\.3 gerekli/);
  assert.equal(result.game.trainingQueue, undefined);
});

test("akın püskürten nöbetçiler deneyim kazanır ve bu savunmaya doğrudan girer", () => {
  const units = { spearman: 20 };
  const experience = rewardRaidExperience(units, {}, 100, 2);
  assert.equal(experienceOf(experience, "spearman"), 6);
  assert.ok(garrisonDefense(units, experience) > garrisonDefense(units), "deneyimli garnizon daha güçlü savunmalı");
});

test("yeni asker gazilerin ortalamasını seyreltir, kayıp ise yalnız hayatta kalan deneyimi taşır", () => {
  const veterans = { spearman: 10 };
  const diluted = recruitUnitExperience(veterans, { spearman: 80 }, { spearman: 10 });
  assert.equal(experienceOf(diluted, "spearman"), 40);
  const survivors = survivorUnitExperience({ spearman: 5 }, diluted);
  assert.equal(experienceOf(survivors, "spearman"), 40);
  assert.equal(armyExperience({ spearman: 5 }, survivors), 40);
  assert.deepEqual(survivorUnitExperience({ spearman: 0 }, survivors), {});
});
