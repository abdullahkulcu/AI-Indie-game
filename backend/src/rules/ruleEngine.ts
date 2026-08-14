import type {
  GameAction,
  GameStateSnapshot,
  ResourceType,
  StructureType,
} from "../models/types.js";
import { chebyshevDistance } from "../game/geometry.js";
import { depositFor, terrainFor } from "../game/mapService.js";

/**
 * Independent, deterministic validation layer. This is the ONLY gate an LLM-produced
 * (or player-triggered) action passes through before it can mutate game state.
 * It never trusts the LLM: every fact it needs (ownership, position, resources,
 * cooldowns, terrain) is re-derived from the authoritative game state snapshot
 * or computed straight from the channel's seed - never taken from the action
 * payload itself.
 */

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

const ATTACK_RANGE = 1; // Chebyshev distance (adjacent, including diagonals)

export const BUILD_COSTS: Record<StructureType, Partial<Record<ResourceType, number>>> = {
  base: { wood: 50, gold: 50 },
  farm: { wood: 30 },
  sawmill: { wood: 20, gold: 10 },
  barracks: { wood: 40, gold: 30, stone: 20 },
  market: { gold: 40 },
  // Deliberately no stone/iron cost - a mine has to be buildable before the
  // player has any stone/iron income to bootstrap from.
  mine: { wood: 30 },
};

/** Recruiting a soldier at a barracks - the "spend your trade earnings on an
 * army" mechanic. */
export const RECRUIT_COST: Partial<Record<ResourceType, number>> = { gold: 40, food: 20 };

function ok(): ValidationResult {
  return { valid: true };
}

function reject(reason: string): ValidationResult {
  return { valid: false, reason };
}

export function validateAttack(
  state: GameStateSnapshot,
  playerId: string,
  action: Extract<GameAction, { type: "attack" }>,
): ValidationResult {
  const attacker = state.units.find((u) => u.id === action.unitId);
  if (!attacker) return reject(`Saldiran birim bulunamadi: ${action.unitId}`);
  if (attacker.ownerPlayerId !== playerId) {
    return reject("Bu birim size ait degil.");
  }
  if (attacker.hp <= 0) return reject("Birim savas disi (hp <= 0).");
  if (attacker.cooldownUntilTick > state.tickNumber) {
    return reject(`Birim bekleme suresinde (tick ${attacker.cooldownUntilTick}'e kadar).`);
  }

  const target = state.units.find((u) => u.id === action.targetUnitId);
  if (!target) return reject(`Hedef birim bulunamadi: ${action.targetUnitId}`);
  if (target.ownerPlayerId === playerId) {
    return reject("Kendi biriminize saldiramazsiniz.");
  }
  if (target.hp <= 0) return reject("Hedef zaten savas disi.");

  const distance = chebyshevDistance(attacker.x, attacker.y, target.x, target.y);
  if (distance > ATTACK_RANGE) {
    return reject(`Hedef menzil disinda (mesafe ${distance}, menzil ${ATTACK_RANGE}).`);
  }

  return ok();
}

export function validateTrade(
  state: GameStateSnapshot,
  playerId: string,
  action: Extract<GameAction, { type: "trade" }>,
): ValidationResult {
  if (action.offerAmount <= 0 || action.requestAmount <= 0) {
    return reject("Ticaret miktarlari pozitif olmalidir.");
  }
  if (action.offerResource === action.requestResource) {
    return reject("Teklif edilen ve istenen kaynak ayni olamaz.");
  }
  if (action.targetPlayerId === playerId) {
    return reject("Kendinizle ticaret yapamazsiniz.");
  }
  const targetPlayer = state.players.find((p) => p.id === action.targetPlayerId);
  if (!targetPlayer) return reject(`Hedef oyuncu bulunamadi: ${action.targetPlayerId}`);

  const ownResources = state.resources.find((r) => r.playerId === playerId);
  if (!ownResources) return reject("Kaynak kaydi bulunamadi.");
  const available = ownResources[action.offerResource];
  if (available < action.offerAmount) {
    return reject(
      `Yetersiz ${action.offerResource}: elinizde ${available}, teklif ${action.offerAmount}.`,
    );
  }

  // Takas anlik ve karsilikli uygulanir (pazarlik/onay yok, MVP kapsami disi):
  // hedef oyuncunun da istenen kaynagi karsilayabilmesi gerekir.
  const targetResources = state.resources.find((r) => r.playerId === action.targetPlayerId);
  if (!targetResources) return reject("Hedef oyuncunun kaynak kaydi bulunamadi.");
  const targetAvailable = targetResources[action.requestResource];
  if (targetAvailable < action.requestAmount) {
    return reject(
      `Hedef oyuncuda yetersiz ${action.requestResource}: mevcut ${targetAvailable}, istenen ${action.requestAmount}.`,
    );
  }

  return ok();
}

export function validateBuild(
  state: GameStateSnapshot,
  playerId: string,
  action: Extract<GameAction, { type: "build" }>,
): ValidationResult {
  if (action.x < 0 || action.x >= state.mapSize || action.y < 0 || action.y >= state.mapSize) {
    return reject(`Koordinat harita disinda: (${action.x}, ${action.y})`);
  }
  const cost = BUILD_COSTS[action.structureType];
  if (!cost) return reject(`Bilinmeyen yapi tipi: ${action.structureType}`);

  const terrain = terrainFor(state.seed, action.x, action.y);
  if (terrain === "water" || terrain === "oasis") return reject("Su/vaha uzerine insa edilemez.");

  if (action.structureType === "mine") {
    const deposit = depositFor(state.seed, action.x, action.y);
    if (!deposit) {
      return reject("Maden ancak bir maden yatagi (dag karosu) uzerine kurulabilir.");
    }
  }

  const claim = state.tiles.find((t) => t.x === action.x && t.y === action.y);
  if (claim?.ownerPlayerId && claim.ownerPlayerId !== playerId) {
    return reject("Bu tile baska bir oyuncuya ait.");
  }

  const occupied = state.structures.some((s) => s.x === action.x && s.y === action.y);
  if (occupied) return reject("Bu tile'da zaten bir yapi var.");

  const ownResources = state.resources.find((r) => r.playerId === playerId);
  if (!ownResources) return reject("Kaynak kaydi bulunamadi.");
  for (const [resource, amount] of Object.entries(cost) as Array<[ResourceType, number]>) {
    if (ownResources[resource] < amount) {
      return reject(
        `Yetersiz ${resource}: elinizde ${ownResources[resource]}, gereken ${amount}.`,
      );
    }
  }

  return ok();
}

export function validateRecruit(
  state: GameStateSnapshot,
  playerId: string,
  action: Extract<GameAction, { type: "recruit" }>,
): ValidationResult {
  const barracks = state.structures.find((s) => s.id === action.structureId);
  if (!barracks) return reject(`Yapi bulunamadi: ${action.structureId}`);
  if (barracks.ownerPlayerId !== playerId) return reject("Bu yapi size ait degil.");
  if (barracks.type !== "barracks") return reject("Sadece kislada asker egitilebilir.");

  const ownResources = state.resources.find((r) => r.playerId === playerId);
  if (!ownResources) return reject("Kaynak kaydi bulunamadi.");
  for (const [resource, amount] of Object.entries(RECRUIT_COST) as Array<[ResourceType, number]>) {
    if (ownResources[resource] < amount) {
      return reject(
        `Yetersiz ${resource}: elinizde ${ownResources[resource]}, gereken ${amount}.`,
      );
    }
  }

  return ok();
}

const TASK_KINDS_NEEDING_COORDS = new Set(["patrol", "raid"]);

export function validateAssignTask(
  state: GameStateSnapshot,
  playerId: string,
  action: Extract<GameAction, { type: "assign_task" }>,
): ValidationResult {
  const unit = state.units.find((u) => u.id === action.unitId);
  if (!unit) return reject(`Birim bulunamadi: ${action.unitId}`);
  if (unit.ownerPlayerId !== playerId) return reject("Bu birim size ait degil.");
  if (unit.hp <= 0) return reject("Birim savas disi (hp <= 0).");

  const { task } = action;
  if (TASK_KINDS_NEEDING_COORDS.has(task.kind)) {
    if (task.targetX === undefined || task.targetY === undefined) {
      return reject(`'${task.kind}' gorevi icin hedef koordinat (target_x, target_y) gerekli.`);
    }
    if (
      task.targetX < 0 ||
      task.targetX >= state.mapSize ||
      task.targetY < 0 ||
      task.targetY >= state.mapSize
    ) {
      return reject(`Hedef koordinat harita disinda: (${task.targetX}, ${task.targetY})`);
    }
  }
  if (task.kind === "escort_trade") {
    if (!task.targetUnitId) return reject("'escort_trade' gorevi icin target_unit_id gerekli.");
    if (!state.units.some((u) => u.id === task.targetUnitId)) {
      return reject(`Eskortlanacak birim bulunamadi: ${task.targetUnitId}`);
    }
  }

  return ok();
}

export function validateAction(
  state: GameStateSnapshot,
  playerId: string,
  action: GameAction,
): ValidationResult {
  switch (action.type) {
    case "attack":
      return validateAttack(state, playerId, action);
    case "trade":
      return validateTrade(state, playerId, action);
    case "build":
      return validateBuild(state, playerId, action);
    case "recruit":
      return validateRecruit(state, playerId, action);
    case "assign_task":
      return validateAssignTask(state, playerId, action);
    default: {
      const exhaustiveCheck: never = action;
      return reject(`Bilinmeyen aksiyon tipi: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}
