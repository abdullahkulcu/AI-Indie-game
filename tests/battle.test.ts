import assert from "node:assert/strict";
import test from "node:test";
import { BATTLE_PHASES, battleVictor, resolveBattle, resolveBattlePhase, unitsLost, type BattleSnapshot } from "../engine/battle";

const setup = {
  seed: "war_1:1000", terrain: "plain" as const,
  attacker: { units: { spearman: 20, archer: 10 }, morale: 70, supplyRatio: 1 },
  defender: { units: { spearman: 20, swordsman: 10 }, morale: 70, supplyRatio: 1 },
  attackerApproach: "balanced" as const, defenderDoctrine: "balanced" as const,
  attackerWithdrawThreshold: 20, defenderWithdrawThreshold: 20,
};

test("saha savaşı aynı girdide aynı safha sonuçlarını üretir", () => {
  assert.deepEqual(resolveBattle(setup), resolveBattle(setup));
});

test("savaş kayıpları başlangıç kuvvetini aşmaz", () => {
  const result = resolveBattle(setup);
  const losses = unitsLost(setup.attacker.units, result.attacker.units);
  assert.ok((losses.spearman ?? 0) <= 20);
  assert.ok((losses.archer ?? 0) <= 10);
  assert.ok(result.phases.length >= 1 && result.phases.length <= 3);
});

test("yüksek geri çekilme eşiği safhaları erken kesebilir", () => {
  const result = resolveBattle({ ...setup, attackerWithdrawThreshold: 80 });
  assert.ok(result.attackerWithdrew || result.phases.length < 3);
});

test("ayrı zamanlarda çözülen safhalar tek parça savaşla aynı sonucu verir", () => {
  let attacker: BattleSnapshot = setup.attacker;
  let defender: BattleSnapshot = setup.defender;
  let attackerWithdrew = false, defenderWithdrew = false;
  for (const phase of BATTLE_PHASES) {
    if (attackerWithdrew || defenderWithdrew) break;
    const step = resolveBattlePhase({ ...setup, phase, attacker, defender });
    attacker = step.attacker;
    defender = step.defender;
    attackerWithdrew = step.attackerWithdrew;
    defenderWithdrew = step.defenderWithdrew;
  }
  const together = resolveBattle(setup);
  assert.deepEqual(attacker, together.attacker);
  assert.deepEqual(defender, together.defender);
  assert.equal(battleVictor(attacker, defender), together.victor);
  assert.equal(attackerWithdrew, together.attackerWithdrew);
  assert.equal(defenderWithdrew, together.defenderWithdrew);
});

test("bin kompozisyon senaryosu negatif kayıp veya belirsiz sonuç üretmez", () => {
  const types = ["spearman", "swordsman", "archer", "cavalry", "siege_team"] as const;
  for (let seed = 0; seed < 1_000; seed++) {
    const units = (offset: number) => Object.fromEntries(types.map((type, index) => [type, 1 + (seed * (index + 3) + offset) % 35]));
    const input = { ...setup, seed: `simulation:${seed}`, terrain: (["plain", "forest", "mountain", "riverbank"] as const)[seed % 4], attacker: { units: units(2), morale: 25 + seed % 70, supplyRatio: (seed % 11) / 10 }, defender: { units: units(7), morale: 25 + (seed * 3) % 70, supplyRatio: (seed % 9) / 8 } };
    const result = resolveBattle(input);
    assert.ok(["attacker", "defender", "draw"].includes(result.victor));
    assert.ok(result.phases.every(phase => Object.values(phase.attackerLosses).every(loss => loss >= 0) && Object.values(phase.defenderLosses).every(loss => loss >= 0)));
    assert.deepEqual(result, resolveBattle(input));
  }
});
