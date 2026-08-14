import { describe, expect, it } from "vitest";
import { validateAction } from "./ruleEngine.js";
import type { GameStateSnapshot, Unit } from "../models/types.js";

const PLAYER_A = "player-a";
const PLAYER_B = "player-b";

function makeUnit(overrides: Partial<Unit>): Unit {
  return {
    id: "unit-1",
    ownerPlayerId: PLAYER_A,
    type: "army",
    x: 0,
    y: 0,
    hp: 10,
    maxHp: 10,
    attack: 3,
    state: "idle",
    targetUnitId: null,
    assignedTask: null,
    cooldownUntilTick: 0,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function baseState(overrides: Partial<GameStateSnapshot> = {}): GameStateSnapshot {
  return {
    tickNumber: 10,
    mapSize: 20,
    tiles: [
      { x: 0, y: 0, terrain: "plains", ownerPlayerId: PLAYER_A },
      { x: 1, y: 0, terrain: "plains", ownerPlayerId: null },
      { x: 19, y: 19, terrain: "water", ownerPlayerId: null },
    ],
    units: [],
    structures: [],
    resources: [
      { playerId: PLAYER_A, gold: 100, wood: 100, food: 100 },
      { playerId: PLAYER_B, gold: 100, wood: 100, food: 100 },
    ],
    players: [
      { id: PLAYER_A, username: "a", email: "a@x.com", createdAt: new Date().toISOString() },
      { id: PLAYER_B, username: "b", email: "b@x.com", createdAt: new Date().toISOString() },
    ],
    ...overrides,
  };
}

describe("attack validation", () => {
  it("accepts an in-range attack on an enemy unit", () => {
    const attacker = makeUnit({ id: "atk", ownerPlayerId: PLAYER_A, x: 5, y: 5 });
    const target = makeUnit({ id: "tgt", ownerPlayerId: PLAYER_B, x: 5, y: 6 });
    const state = baseState({ units: [attacker, target] });

    const result = validateAction(state, PLAYER_A, {
      type: "attack",
      unitId: "atk",
      targetUnitId: "tgt",
    });

    expect(result.valid).toBe(true);
  });

  it("rejects attacking a unit you do not own", () => {
    const foreignUnit = makeUnit({ id: "not-mine", ownerPlayerId: PLAYER_B, x: 5, y: 5 });
    const target = makeUnit({ id: "tgt", ownerPlayerId: PLAYER_A, x: 5, y: 6 });
    const state = baseState({ units: [foreignUnit, target] });

    const result = validateAction(state, PLAYER_A, {
      type: "attack",
      unitId: "not-mine",
      targetUnitId: "tgt",
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/size ait degil/);
  });

  it("rejects attacking your own unit", () => {
    const a = makeUnit({ id: "a", ownerPlayerId: PLAYER_A, x: 5, y: 5 });
    const b = makeUnit({ id: "b", ownerPlayerId: PLAYER_A, x: 5, y: 6 });
    const state = baseState({ units: [a, b] });

    const result = validateAction(state, PLAYER_A, {
      type: "attack",
      unitId: "a",
      targetUnitId: "b",
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Kendi biriminize/);
  });

  it("rejects an out-of-range attack", () => {
    const attacker = makeUnit({ id: "atk", ownerPlayerId: PLAYER_A, x: 0, y: 0 });
    const target = makeUnit({ id: "tgt", ownerPlayerId: PLAYER_B, x: 10, y: 10 });
    const state = baseState({ units: [attacker, target] });

    const result = validateAction(state, PLAYER_A, {
      type: "attack",
      unitId: "atk",
      targetUnitId: "tgt",
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/menzil disinda/);
  });

  it("rejects an attack while the unit is on cooldown", () => {
    const attacker = makeUnit({
      id: "atk",
      ownerPlayerId: PLAYER_A,
      x: 5,
      y: 5,
      cooldownUntilTick: 999,
    });
    const target = makeUnit({ id: "tgt", ownerPlayerId: PLAYER_B, x: 5, y: 6 });
    const state = baseState({ units: [attacker, target] });

    const result = validateAction(state, PLAYER_A, {
      type: "attack",
      unitId: "atk",
      targetUnitId: "tgt",
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/bekleme suresinde/);
  });
});

describe("trade validation", () => {
  it("accepts a trade the player can afford", () => {
    const state = baseState();
    const result = validateAction(state, PLAYER_A, {
      type: "trade",
      offerResource: "wood",
      offerAmount: 20,
      requestResource: "gold",
      requestAmount: 10,
      targetPlayerId: PLAYER_B,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a trade the player cannot afford", () => {
    const state = baseState({
      resources: [
        { playerId: PLAYER_A, gold: 5, wood: 5, food: 5 },
        { playerId: PLAYER_B, gold: 100, wood: 100, food: 100 },
      ],
    });
    const result = validateAction(state, PLAYER_A, {
      type: "trade",
      offerResource: "wood",
      offerAmount: 50,
      requestResource: "gold",
      requestAmount: 10,
      targetPlayerId: PLAYER_B,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Yetersiz wood/);
  });

  it("rejects a trade the target player cannot fulfill", () => {
    const state = baseState({
      resources: [
        { playerId: PLAYER_A, gold: 100, wood: 100, food: 100 },
        { playerId: PLAYER_B, gold: 2, wood: 100, food: 100 },
      ],
    });
    const result = validateAction(state, PLAYER_A, {
      type: "trade",
      offerResource: "wood",
      offerAmount: 10,
      requestResource: "gold",
      requestAmount: 20,
      targetPlayerId: PLAYER_B,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Hedef oyuncuda yetersiz/);
  });

  it("rejects trading with yourself", () => {
    const state = baseState();
    const result = validateAction(state, PLAYER_A, {
      type: "trade",
      offerResource: "wood",
      offerAmount: 10,
      requestResource: "gold",
      requestAmount: 10,
      targetPlayerId: PLAYER_A,
    });
    expect(result.valid).toBe(false);
  });
});

describe("build validation", () => {
  it("accepts building on an owned, empty, non-water tile the player can afford", () => {
    const state = baseState();
    const result = validateAction(state, PLAYER_A, {
      type: "build",
      structureType: "farm",
      x: 0,
      y: 0,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects building on water", () => {
    const state = baseState();
    const result = validateAction(state, PLAYER_A, {
      type: "build",
      structureType: "farm",
      x: 19,
      y: 19,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Su uzerine/);
  });

  it("rejects building on another player's tile", () => {
    const state = baseState({
      tiles: [{ x: 0, y: 0, terrain: "plains", ownerPlayerId: PLAYER_B }],
    });
    const result = validateAction(state, PLAYER_A, {
      type: "build",
      structureType: "farm",
      x: 0,
      y: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/baska bir oyuncuya ait/);
  });

  it("rejects building without sufficient resources", () => {
    const state = baseState({
      resources: [
        { playerId: PLAYER_A, gold: 0, wood: 0, food: 0 },
        { playerId: PLAYER_B, gold: 100, wood: 100, food: 100 },
      ],
    });
    const result = validateAction(state, PLAYER_A, {
      type: "build",
      structureType: "base",
      x: 0,
      y: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Yetersiz/);
  });

  it("rejects building on an already-occupied tile", () => {
    const state = baseState({
      structures: [
        {
          id: "s1",
          ownerPlayerId: PLAYER_A,
          type: "farm",
          x: 0,
          y: 0,
          level: 1,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    const result = validateAction(state, PLAYER_A, {
      type: "build",
      structureType: "sawmill",
      x: 0,
      y: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/zaten bir yapi/);
  });

  it("rejects out-of-bounds coordinates", () => {
    const state = baseState();
    const result = validateAction(state, PLAYER_A, {
      type: "build",
      structureType: "farm",
      x: 100,
      y: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/harita disinda/);
  });
});
