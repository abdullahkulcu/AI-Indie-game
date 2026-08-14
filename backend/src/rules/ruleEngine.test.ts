import { describe, expect, it } from "vitest";
import { validateAction } from "./ruleEngine.js";
import { depositFor, terrainFor } from "../game/mapService.js";
import type { GameStateSnapshot, Unit } from "../models/types.js";

const PLAYER_A = "player-a";
const PLAYER_B = "player-b";
const SEED = 1;
const MAP_SIZE = 300;

/** Terrain/deposits are a pure function of (seed, x, y) now (see
 * mapService.ts) rather than fixtures we can just declare - so tests find
 * real coordinates on the seed-1 map that match the terrain they need. */
function findCoord(predicate: (x: number, y: number) => boolean): { x: number; y: number } {
  for (let x = 0; x < MAP_SIZE; x += 1) {
    for (let y = 0; y < MAP_SIZE; y += 1) {
      if (predicate(x, y)) return { x, y };
    }
  }
  throw new Error("no matching coordinate found for seed " + SEED);
}

const PLAINS_A = findCoord((x, y) => terrainFor(SEED, x, y) === "plains");
const PLAINS_B = findCoord(
  (x, y) => terrainFor(SEED, x, y) === "plains" && (x !== PLAINS_A.x || y !== PLAINS_A.y),
);
const WATER = findCoord((x, y) => terrainFor(SEED, x, y) === "water");
const DEPOSIT = findCoord((x, y) => depositFor(SEED, x, y) !== null);

function makeUnit(overrides: Partial<Unit>): Unit {
  return {
    id: "unit-1",
    ownerPlayerId: PLAYER_A,
    channelId: "channel-1",
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
    channelId: "channel-1",
    seed: SEED,
    tickNumber: 10,
    mapSize: MAP_SIZE,
    tiles: [{ x: PLAINS_A.x, y: PLAINS_A.y, terrain: "plains", ownerPlayerId: PLAYER_A }],
    units: [],
    structures: [],
    resources: [
      { playerId: PLAYER_A, gold: 100, wood: 100, food: 100, stone: 100, iron: 100 },
      { playerId: PLAYER_B, gold: 100, wood: 100, food: 100, stone: 100, iron: 100 },
    ],
    players: [
      {
        id: PLAYER_A,
        username: "a",
        email: "a@x.com",
        channelId: "channel-1",
        createdAt: new Date().toISOString(),
      },
      {
        id: PLAYER_B,
        username: "b",
        email: "b@x.com",
        channelId: "channel-1",
        createdAt: new Date().toISOString(),
      },
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
        { playerId: PLAYER_A, gold: 5, wood: 5, food: 5, stone: 0, iron: 0 },
        { playerId: PLAYER_B, gold: 100, wood: 100, food: 100, stone: 0, iron: 0 },
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
        { playerId: PLAYER_A, gold: 100, wood: 100, food: 100, stone: 0, iron: 0 },
        { playerId: PLAYER_B, gold: 2, wood: 100, food: 100, stone: 0, iron: 0 },
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
      x: PLAINS_A.x,
      y: PLAINS_A.y,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects building on water", () => {
    const state = baseState();
    const result = validateAction(state, PLAYER_A, {
      type: "build",
      structureType: "farm",
      x: WATER.x,
      y: WATER.y,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Su uzerine/);
  });

  it("rejects building on another player's claimed tile", () => {
    const state = baseState({
      tiles: [{ x: PLAINS_A.x, y: PLAINS_A.y, terrain: "plains", ownerPlayerId: PLAYER_B }],
    });
    const result = validateAction(state, PLAYER_A, {
      type: "build",
      structureType: "farm",
      x: PLAINS_A.x,
      y: PLAINS_A.y,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/baska bir oyuncuya ait/);
  });

  it("rejects building without sufficient resources", () => {
    const state = baseState({
      resources: [
        { playerId: PLAYER_A, gold: 0, wood: 0, food: 0, stone: 0, iron: 0 },
        { playerId: PLAYER_B, gold: 100, wood: 100, food: 100, stone: 100, iron: 100 },
      ],
    });
    const result = validateAction(state, PLAYER_A, {
      type: "build",
      structureType: "base",
      x: PLAINS_A.x,
      y: PLAINS_A.y,
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
          channelId: "channel-1",
          type: "farm",
          x: PLAINS_A.x,
          y: PLAINS_A.y,
          level: 1,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    const result = validateAction(state, PLAYER_A, {
      type: "build",
      structureType: "sawmill",
      x: PLAINS_A.x,
      y: PLAINS_A.y,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/zaten bir yapi/);
  });

  it("rejects out-of-bounds coordinates", () => {
    const state = baseState();
    const result = validateAction(state, PLAYER_A, {
      type: "build",
      structureType: "farm",
      x: MAP_SIZE + 5,
      y: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/harita disinda/);
  });

  it("accepts a mine on a resource deposit tile", () => {
    const state = baseState({
      resources: [
        { playerId: PLAYER_A, gold: 100, wood: 100, food: 100, stone: 100, iron: 100 },
        { playerId: PLAYER_B, gold: 100, wood: 100, food: 100, stone: 100, iron: 100 },
      ],
    });
    const result = validateAction(state, PLAYER_A, {
      type: "build",
      structureType: "mine",
      x: DEPOSIT.x,
      y: DEPOSIT.y,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a mine that isn't on a deposit", () => {
    const state = baseState();
    const result = validateAction(state, PLAYER_A, {
      type: "build",
      structureType: "mine",
      x: PLAINS_B.x,
      y: PLAINS_B.y,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/maden yatagi/);
  });
});

describe("recruit validation", () => {
  function barracksState(overrides: Partial<GameStateSnapshot> = {}) {
    return baseState({
      structures: [
        {
          id: "barracks-1",
          ownerPlayerId: PLAYER_A,
          channelId: "channel-1",
          type: "barracks",
          x: PLAINS_A.x,
          y: PLAINS_A.y,
          level: 1,
          createdAt: new Date().toISOString(),
        },
      ],
      ...overrides,
    });
  }

  it("accepts recruiting at an owned barracks with enough resources", () => {
    const state = barracksState();
    const result = validateAction(state, PLAYER_A, { type: "recruit", structureId: "barracks-1" });
    expect(result.valid).toBe(true);
  });

  it("rejects recruiting at a barracks you do not own", () => {
    const state = barracksState();
    const result = validateAction(state, PLAYER_B, { type: "recruit", structureId: "barracks-1" });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/size ait degil/);
  });

  it("rejects recruiting at a non-barracks structure", () => {
    const state = baseState({
      structures: [
        {
          id: "farm-1",
          ownerPlayerId: PLAYER_A,
          channelId: "channel-1",
          type: "farm",
          x: PLAINS_A.x,
          y: PLAINS_A.y,
          level: 1,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    const result = validateAction(state, PLAYER_A, { type: "recruit", structureId: "farm-1" });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/kislada/);
  });

  it("rejects recruiting without enough resources", () => {
    const state = barracksState({
      resources: [
        { playerId: PLAYER_A, gold: 0, wood: 0, food: 0, stone: 0, iron: 0 },
        { playerId: PLAYER_B, gold: 100, wood: 100, food: 100, stone: 100, iron: 100 },
      ],
    });
    const result = validateAction(state, PLAYER_A, { type: "recruit", structureId: "barracks-1" });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Yetersiz/);
  });
});
