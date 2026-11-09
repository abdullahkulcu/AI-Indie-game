/**
 * Eşzamansız saha savaşının saf ve deterministik çözücüsü.
 *
 * Bu dosya zaman, veritabanı ve rastgelelik bilmez. Aynı savaş kimliği ile
 * aynı kuvvetler her zaman aynı safha raporunu üretir; cron yeniden çalışsa
 * bile oyuncu sayfayı yenileyerek başka sonuç alamaz.
 */
import { terrainCatalog } from "./catalog";
import { normalizeCampaignUnits, type CampaignUnits } from "./march";
import type { TerrainId } from "./types";
import { unitCatalog, unitOf, type UnitType } from "./units";
import type { DefenseDoctrine, WarApproach } from "./war";

export type BattlePhase = "volley" | "line" | "pursuit";
export type BattleSide = "attacker" | "defender";

export type BattleSnapshot = {
  units: CampaignUnits;
  morale: number;
  supplyRatio: number;
};

export type BattlePhaseResult = {
  phase: BattlePhase;
  attackerLosses: CampaignUnits;
  defenderLosses: CampaignUnits;
  attackerMorale: number;
  defenderMorale: number;
  attackerPower: number;
  defenderPower: number;
};

export type BattleResult = {
  phases: BattlePhaseResult[];
  attacker: BattleSnapshot;
  defender: BattleSnapshot;
  victor: "attacker" | "defender" | "draw";
  attackerWithdrew: boolean;
  defenderWithdrew: boolean;
};

export const BATTLE_PHASES: readonly BattlePhase[] = ["volley", "line", "pursuit"] as const;

export type BattlePhaseStep = BattlePhaseResult & {
  attacker: BattleSnapshot;
  defender: BattleSnapshot;
  attackerWithdrew: boolean;
  defenderWithdrew: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const count = (units: CampaignUnits, type: UnitType) => Math.max(0, Math.floor(units[type] ?? 0));
const total = (units: CampaignUnits) => unitCatalog.reduce((sum, unit) => sum + count(units, unit.type), 0);

/** Karşı birlik katsayılarının tek kaynağı. */
const COUNTERS: Partial<Record<UnitType, Partial<Record<UnitType, number>>>> = {
  spearman: { cavalry: 1.35 },
  swordsman: { spearman: 1.2 },
  archer: { swordsman: 1.2 },
  cavalry: { archer: 1.35, spearman: .65 },
};

const approachModifier = (approach: WarApproach | DefenseDoctrine, side: BattleSide) => {
  if (approach === "cautious") return side === "attacker" ? .92 : 1.02;
  if (approach === "intense" || approach === "hard_response") return 1.1;
  return 1;
};

const lossModifier = (approach: WarApproach | DefenseDoctrine) =>
  approach === "cautious" ? .82 : approach === "intense" || approach === "hard_response" ? 1.16 : 1;

function hash(seed: string) {
  let value = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

function counterMultiplier(type: UnitType, enemy: CampaignUnits) {
  const enemyTotal = Math.max(1, total(enemy));
  return unitCatalog.reduce((sum, opponent) => sum + count(enemy, opponent.type) / enemyTotal * (COUNTERS[type]?.[opponent.type] ?? 1), 0);
}

function phasePower(units: CampaignUnits, enemy: CampaignUnits, phase: BattlePhase) {
  return unitCatalog.reduce((sum, unit) => {
    const phaseValue = phase === "volley"
      ? unit.type === "archer" ? unit.attack * 1.45 : unit.attack * .12
      : phase === "line" ? (unit.attack + unit.defense) / 2
      : unit.type === "cavalry" ? unit.attack * 1.3 + unit.speed : unit.attack * .22 + unit.speed * .25;
    return sum + count(units, unit.type) * phaseValue * counterMultiplier(unit.type, enemy);
  }, 0);
}

function lossDistribution(units: CampaignUnits, requested: number, phase: BattlePhase, seed: string) {
  const clean = normalizeCampaignUnits(units);
  const maximum = total(clean);
  let remaining = Math.min(maximum, Math.max(0, Math.floor(requested)));
  const losses: CampaignUnits = {};
  const priority = unitCatalog.map(unit => {
    const exposure = phase === "volley" && unit.type === "archer" ? 1.45
      : phase === "pursuit" && unit.type !== "cavalry" ? 1.25 : 1;
    return { type: unit.type, score: count(clean, unit.type) * exposure + (hash(`${seed}:${unit.type}`) % 100) / 10_000 };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  const scoreTotal = priority.reduce((sum, item) => sum + item.score, 0);
  for (const item of priority) {
    if (!remaining) break;
    const proportional = Math.floor(requested * item.score / scoreTotal);
    const taken = Math.min(count(clean, item.type), proportional, remaining);
    if (taken) { losses[item.type] = taken; remaining -= taken; }
  }
  // Oransal tur, küçük birlik gruplarında bütün kaybı dağıtamayabilir. Tek
  // tur atmak beş birlik türünden fazlasını hiçbir zaman seçmiyordu; örneğin
  // yalnız iki türde 12 kayıp istenince sonuç hatalı biçimde 2'de kalıyordu.
  // Kalanı öncelik sırasıyla, birimler bitene kadar paylaştırıyoruz.
  while (remaining > 0) {
    let progressed = false;
    for (const item of priority) {
      if (!remaining) break;
      const open = count(clean, item.type) - (losses[item.type] ?? 0);
      if (open > 0) {
        losses[item.type] = (losses[item.type] ?? 0) + 1;
        remaining--;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return losses;
}

function afterLoss(units: CampaignUnits, losses: CampaignUnits) {
  const next: CampaignUnits = {};
  for (const unit of unitCatalog) {
    const left = count(units, unit.type) - count(losses, unit.type);
    if (left > 0) next[unit.type] = left;
  }
  return next;
}

function sidePower(input: {
  units: CampaignUnits; enemy: CampaignUnits; phase: BattlePhase; side: BattleSide;
  approach: WarApproach | DefenseDoctrine; terrain: TerrainId;
}) {
  const base = phasePower(input.units, input.enemy, input.phase);
  const terrain = input.side === "defender" ? terrainCatalog[input.terrain].defense : 1;
  return base * terrain * approachModifier(input.approach, input.side);
}

/** Bir safhayı çözer; bu fonksiyonun çıktısı sonraki safhanın tam girdisidir. */
export function resolveBattlePhase(input: {
  seed: string;
  phase: BattlePhase;
  terrain: TerrainId;
  attacker: BattleSnapshot;
  defender: BattleSnapshot;
  attackerApproach: WarApproach;
  defenderDoctrine: DefenseDoctrine;
  attackerWithdrawThreshold: number;
  defenderWithdrawThreshold: number;
}): BattlePhaseStep {
  const attacker = { ...input.attacker, units: normalizeCampaignUnits(input.attacker.units), morale: clamp(input.attacker.morale, 0, 100), supplyRatio: clamp(input.attacker.supplyRatio, 0, 1) };
  const defender = { ...input.defender, units: normalizeCampaignUnits(input.defender.units), morale: clamp(input.defender.morale, 0, 100), supplyRatio: clamp(input.defender.supplyRatio, 0, 1) };
  const attackerPower = sidePower({ units: attacker.units, enemy: defender.units, phase: input.phase, side: "attacker", approach: input.attackerApproach, terrain: input.terrain })
    * (.6 + attacker.morale / 250) * (.6 + attacker.supplyRatio * .4);
  const defenderPower = sidePower({ units: defender.units, enemy: attacker.units, phase: input.phase, side: "defender", approach: input.defenderDoctrine, terrain: input.terrain })
    * (.6 + defender.morale / 250) * (.6 + defender.supplyRatio * .4);
  const attackerSize = Math.max(1, total(attacker.units)), defenderSize = Math.max(1, total(defender.units));
  const attackerLossRate = clamp(.08 * defenderPower / Math.max(1, attackerPower) * lossModifier(input.attackerApproach), .03, .18);
  const defenderLossRate = clamp(.08 * attackerPower / Math.max(1, defenderPower) * lossModifier(input.defenderDoctrine), .03, .18);
  const attackerLosses = lossDistribution(attacker.units, Math.max(1, Math.round(attackerSize * attackerLossRate)), input.phase, `${input.seed}:${input.phase}:a`);
  const defenderLosses = lossDistribution(defender.units, Math.max(1, Math.round(defenderSize * defenderLossRate)), input.phase, `${input.seed}:${input.phase}:d`);
  const nextAttacker = { ...attacker, units: afterLoss(attacker.units, attackerLosses), morale: clamp(attacker.morale - (Object.values(attackerLosses).reduce((sum, value) => sum + (value ?? 0), 0) / attackerSize) * 38, 0, 100) };
  const nextDefender = { ...defender, units: afterLoss(defender.units, defenderLosses), morale: clamp(defender.morale - (Object.values(defenderLosses).reduce((sum, value) => sum + (value ?? 0), 0) * 38 / defenderSize), 0, 100) };
  return {
    phase: input.phase, attackerLosses, defenderLosses,
    attackerMorale: nextAttacker.morale, defenderMorale: nextDefender.morale,
    attackerPower, defenderPower,
    attacker: nextAttacker, defender: nextDefender,
    attackerWithdrew: nextAttacker.morale <= input.attackerWithdrawThreshold || !total(nextAttacker.units),
    defenderWithdrew: nextDefender.morale <= input.defenderWithdrawThreshold || !total(nextDefender.units),
  };
}

export function battleVictor(attacker: BattleSnapshot, defender: BattleSnapshot): "attacker" | "defender" | "draw" {
  const attackerStrength = total(attacker.units) * (attacker.morale / 100 + .25);
  const defenderStrength = total(defender.units) * (defender.morale / 100 + .25);
  return Math.abs(attackerStrength - defenderStrength) < .01 ? "draw" : attackerStrength > defenderStrength ? "attacker" : "defender";
}

/** Üç safhalı, kayıp tavanı olan saha savaşı. */
export function resolveBattle(input: {
  seed: string;
  terrain: TerrainId;
  attacker: BattleSnapshot;
  defender: BattleSnapshot;
  attackerApproach: WarApproach;
  defenderDoctrine: DefenseDoctrine;
  attackerWithdrawThreshold: number;
  defenderWithdrawThreshold: number;
}): BattleResult {
  let attacker: BattleSnapshot = { ...input.attacker, units: normalizeCampaignUnits(input.attacker.units), morale: clamp(input.attacker.morale, 0, 100), supplyRatio: clamp(input.attacker.supplyRatio, 0, 1) };
  let defender: BattleSnapshot = { ...input.defender, units: normalizeCampaignUnits(input.defender.units), morale: clamp(input.defender.morale, 0, 100), supplyRatio: clamp(input.defender.supplyRatio, 0, 1) };
  const phases: BattlePhaseResult[] = [];
  let attackerWithdrew = false, defenderWithdrew = false;

  for (const phase of BATTLE_PHASES) {
    if (!total(attacker.units) || !total(defender.units) || attackerWithdrew || defenderWithdrew) break;
    const step = resolveBattlePhase({ ...input, phase, attacker, defender });
    attacker = step.attacker;
    defender = step.defender;
    phases.push(step);
    attackerWithdrew = step.attackerWithdrew;
    defenderWithdrew = step.defenderWithdrew;
  }
  const victor = battleVictor(attacker, defender);
  return { phases, attacker, defender, victor, attackerWithdrew, defenderWithdrew };
}

export function unitsLost(before: CampaignUnits, after: CampaignUnits): CampaignUnits {
  const losses: CampaignUnits = {};
  for (const unit of unitCatalog) {
    const lost = count(before, unit.type) - count(after, unit.type);
    if (lost > 0) losses[unit.type] = lost;
  }
  return losses;
}

export function describeBattlePhase(result: BattlePhaseResult) {
  const label: Record<BattlePhase, string> = { volley: "Atış safhası", line: "Hat çatışması", pursuit: "Moral ve takip" };
  const lost = (units: CampaignUnits) => Object.entries(units).map(([type, amount]) => `${unitOf(type)?.name ?? type} ${amount}`).join(", ") || "kayıp yok";
  return `${label[result.phase]}: saldıran ${lost(result.attackerLosses)} kaybetti; savunan ${lost(result.defenderLosses)} kaybetti.`;
}
