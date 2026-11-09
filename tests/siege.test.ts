import assert from "node:assert/strict";
import test from "node:test";
import { resolveSiege, SIEGE_GAME_HOURS, siegeFoodCost } from "../engine/siege";

test("kuşatma aynı kuvvet ve tahkimatta deterministiktir", () => {
  const input = { attacker: { spearman: 30, siege_team: 8 }, defender: { spearman: 20 }, keepLevel: 2, wallLevel: 2, attackerSupplyRatio: .8 };
  assert.deepEqual(resolveSiege(input), resolveSiege(input));
});

test("kuşatma ekibi baskıyı yükseltir, tahkimat savunmayı güçlendirir", () => {
  const low = resolveSiege({ attacker: { spearman: 30 }, defender: { spearman: 20 }, keepLevel: 2, wallLevel: 2, attackerSupplyRatio: 1 });
  const high = resolveSiege({ attacker: { spearman: 30, siege_team: 8 }, defender: { spearman: 20 }, keepLevel: 2, wallLevel: 2, attackerSupplyRatio: 1 });
  const fortified = resolveSiege({ attacker: { spearman: 30, siege_team: 8 }, defender: { spearman: 20 }, keepLevel: 5, wallLevel: 5, attackerSupplyRatio: 1 });
  assert.ok(high.progress > low.progress);
  assert.ok(fortified.progress < high.progress);
});

test("kuşatma erzağı birlik kataloğu ve sabit oyun süresinden türer", () => {
  assert.equal(SIEGE_GAME_HOURS, 6);
  assert.ok(siegeFoodCost({ spearman: 10 }) > 0);
  assert.ok(siegeFoodCost({ spearman: 10 }, 12) > siegeFoodCost({ spearman: 10 }, 6));
});

test("aç garnizonun kuşatma direnci düşer", () => {
  const input = { attacker: { spearman: 30, siege_team: 8 }, defender: { spearman: 20 }, keepLevel: 3, wallLevel: 3, attackerSupplyRatio: 1 };
  const fed = resolveSiege({ ...input, defenderSupplyRatio: 1 });
  const hungry = resolveSiege({ ...input, defenderSupplyRatio: 0 });
  assert.ok(hungry.progress > fed.progress);
});
