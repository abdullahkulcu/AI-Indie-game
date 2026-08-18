import assert from "node:assert/strict";
import test from "node:test";
import { applyPolicy, clampPolicy } from "../engine/policy";
import type { Game } from "../engine/types";

const T0 = 1_800_000_000_000;

function newGame(overrides: Partial<Game> = {}): Game {
  return {
    version: 2, kingdomName: "Demirkale", rulerName: "Alaric", channel: "Standart Sezon I", channelId: "standard",
    speed: 1, terrain: "plain", foundedAt: T0, lastTickAt: T0, protectionEndsAt: T0 + 4 * 86_400_000,
    resources: { gold: 5000, food: 5000, stone: 1000, wood: 1000, iron: 500, ale: 500 },
    population: 100, capacity: 150, popularity: 50, reputation: 50, loyalty: 75, taxRate: 15, quota: 6, quotaAt: T0,
    buildings: [{ type: "keep", name: "Kale", category: "Yönetim", level: 1 }],
    units: { spearman: 0 }, queue: null, notices: [], provider: null, model: null, generalConnected: false,
    ...overrides,
  };
}

test("politika değerleri sınırlara oturur", () => {
  assert.equal(clampPolicy("taxRate", 90), 50);
  assert.equal(clampPolicy("taxRate", -5), 0);
  assert.equal(clampPolicy("foodRation", 500), 200);
  assert.equal(clampPolicy("aleRation", -20), 0);
});

test("Kral istihkakı doğrudan çevirir; General'e sormaz", () => {
  const { game, comment } = applyPolicy(newGame(), { key: "foodRation", value: 150 });
  assert.equal(game.foodRation, 150);
  assert.ok(comment.length > 0, "General her değişiklikte bir şey söylemeli");
});

test("vergi doğrudan değişir ve deftere ferman düşer", () => {
  const { game } = applyPolicy(newGame(), { key: "taxRate", value: 35 });
  assert.equal(game.taxRate, 35);
  assert.equal(game.notices[0].kind, "FERMAN");
  assert.match(game.notices[0].text, /Vergi %35/);
});

test("açlık sınırındaki istihkakta General sert konuşur", () => {
  const { comment } = applyPolicy(newGame(), { key: "foodRation", value: 30 });
  assert.match(comment, /açlıktan/);
});

test("soygun düzeyindeki vergide General isyanı hatırlatır", () => {
  const { comment } = applyPolicy(newGame(), { key: "taxRate", value: 48 });
  assert.match(comment, /soygun|isyan/);
});

test("Bira Evi yokken bira istihkakının kâğıt üstünde kalacağı söylenir", () => {
  const { comment } = applyPolicy(newGame(), { key: "aleRation", value: 100 });
  assert.match(comment, /Bira Evi/);
});

test("halk iş bırakmışken General zamanlamayı eleştirir", () => {
  const striking = newGame({ popularity: 12 });
  const { comment } = applyPolicy(striking, { key: "taxRate", value: 30 });
  assert.match(comment, /zamanlaması kötü/);
});

test("politika değişikliği başka alanları bozmaz", () => {
  const before = newGame();
  const { game } = applyPolicy(before, { key: "aleRation", value: 80 });
  assert.deepEqual(game.resources, before.resources);
  assert.equal(game.population, before.population);
  assert.equal(game.taxRate, before.taxRate);
});
