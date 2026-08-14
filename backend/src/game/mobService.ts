import type { Channel } from "../models/types.js";
import { terrainFor } from "./mapService.js";
import { countAliveMobs, spawnUnit } from "../repositories/unitRepository.js";

/**
 * Keeps every channel populated with a handful of wild, neutral-hostile mobs
 * (owner_player_id = NULL) - something to actually fight (recruit a soldier,
 * march it out, kill a mob) even before another player is reachable. Mobs
 * never seek players out on their own; they only fight back if attacked
 * (the existing auto-retaliation FSM in stateMachine.ts already handles any
 * unit regardless of owner), so they read as guardians/wildlife rather than
 * a proactive threat.
 */

const MOB_TARGET_COUNT = 5;
const MOB_HP = 15;
const MOB_ATTACK = 3;
const MOB_SPAWNABLE_TERRAIN = new Set(["plains", "desert", "forest", "mountain"]);

function randomMobPosition(seed: number, mapSize: number): { x: number; y: number } {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const x = Math.floor(Math.random() * mapSize);
    const y = Math.floor(Math.random() * mapSize);
    if (MOB_SPAWNABLE_TERRAIN.has(terrainFor(seed, x, y))) return { x, y };
  }
  return { x: Math.floor(mapSize / 2), y: Math.floor(mapSize / 2) };
}

/** Tops a channel's live mob count back up to MOB_TARGET_COUNT - called once
 * per tick before the snapshot loads, so newly spawned mobs are immediately
 * part of that tick's state. */
export async function ensureChannelMobs(channel: Channel): Promise<void> {
  const aliveMobs = await countAliveMobs(channel.id);
  for (let i = aliveMobs; i < MOB_TARGET_COUNT; i += 1) {
    const { x, y } = randomMobPosition(channel.seed, channel.mapSize);
    await spawnUnit(null, channel.id, "mob", x, y, MOB_HP, MOB_ATTACK);
  }
}
