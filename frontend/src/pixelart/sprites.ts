import type { Texture } from "pixi.js";
import { getSpriteTexture, sprite, type Legend } from "./asciiSprite";
import { CROP, METAL, OUTLINE, SKIN, STONE, THATCH, WALL, WOOD } from "./palette";

/** Building and unit art, defined as compact ASCII pixel-art ("big pixel" per
 * character) and rasterized on demand. "$" is reserved for the owning
 * player's accent color, so one definition covers every player - buildings
 * stay in neutral materials with a colored flag/banner, units wear the
 * accent as their tunic/cart color, matching how Age of Empires-era games
 * showed ownership without recoloring the whole sprite. */

const SPRITE_SCALE = 4;

export type StructureType = "base" | "farm" | "sawmill" | "barracks" | "market";
export type UnitType = "army" | "caravan";

const BUILDING_LEGEND: Legend = {
  O: OUTLINE,
  R: THATCH.mid,
  W: WALL.mid,
  D: WOOD.dark,
  F: CROP.mid,
  f: CROP.light,
  L: WOOD.mid,
  l: WOOD.light,
  S: STONE.mid,
};

const BUILDINGS: Record<StructureType, string[]> = {
  base: [
    "......$......",
    "......O......",
    ".....OOO.....",
    "....ORRRO....",
    "...ORRRRRO...",
    "..OWWWWWWWO..",
    ".OWWWWWWWWWO.",
    "OWWWWODOWWWWO",
    "OWWWWODOWWWWO",
    "OWWWWWWWWWWWO",
    ".OOOOOOOOOOO.",
  ],
  farm: [
    "......$......",
    ".OOOOOOOOOOO.",
    "OFFFfFFFfFFFO",
    "OfFFFfFFFfFFO",
    "OFFFfFFFfFFFO",
    "OfFFFfFFFfFFO",
    "OFFFfFFFfFFFO",
    ".OOOOOOOOOOO.",
  ],
  sawmill: [
    ".......$.....",
    ".......O.....",
    "......OWO....",
    ".....OWWWO...",
    ".OOOOWWWWWOO.",
    "OLLLLLLLLLLLO",
    "OlLlLlLlLlLlO",
    "OLLLLLLLLLLLO",
    ".OOOOOOOOOOO.",
  ],
  barracks: [
    ".....$...$.....",
    ".....O...O.....",
    "....OOO.OOO....",
    "....OSO.OSO....",
    "...OOSOOOSOO...",
    "..OWWWWWWWWWO..",
    ".OWWWWWWWWWWWO.",
    "OWWWWWWWWWWWWWO",
    "OWWWWWODOOWWWWO",
    "OWWWWWWWWWWWWWO",
    ".OOOOOOOOOOOOO.",
  ],
  market: [
    ".OOOOOOOOOOO.",
    "O$W$W$W$W$WO.",
    "OW$W$W$W$WWO.",
    ".OOOOOOOOOO..",
    "...O.....O...",
    "...O.....O...",
    "..O.......O..",
    "..O.......O..",
  ],
};

const UNIT_LEGEND: Legend = {
  O: OUTLINE,
  W: METAL,
  H: SKIN,
};

const UNITS: Record<UnitType, string[]> = {
  army: [
    "....O....",
    "....W....",
    "....W....",
    "...OOO...",
    "..OHHHO..",
    "..OHHHO..",
    ".OO$$$OO.",
    "O$$$$$$O.",
    ".O$$$$O..",
    "..O$$O...",
    "..O..O...",
    ".sssssss.",
  ],
  caravan: [
    "..OOOOOOO..",
    ".O$$$$$$$O.",
    ".O$$$$$$$O.",
    ".OOOOOOOOO.",
    "O....O....O",
    "O.OOO.OOO.O",
    "..O.....O..",
    ".sssssssss.",
  ],
};

export function getBuildingTexture(type: StructureType, accent: string): Texture {
  return getSpriteTexture(
    `building:${type}:${accent}`,
    sprite(BUILDINGS[type]),
    BUILDING_LEGEND,
    SPRITE_SCALE,
    accent,
  );
}

export function getUnitTexture(type: UnitType, accent: string): Texture {
  return getSpriteTexture(`unit:${type}:${accent}`, sprite(UNITS[type]), UNIT_LEGEND, SPRITE_SCALE, accent);
}
