import type { Texture } from "pixi.js";
import { getSpriteTexture, sprite, type Legend } from "./asciiSprite";
import { CROP, METAL, OUTLINE, SKIN, STONE, THATCH, WALL, WOOD } from "./palette";

/** Building and unit art, defined as compact ASCII pixel-art ("big pixel" per
 * character) and rasterized on demand. "$"/"@"/"%" are reserved for the
 * owning player's accent color and its auto-derived dark/light shades (see
 * asciiSprite.ts) - buildings stay in neutral materials with a colored
 * flag/banner or decoration, units wear the accent (with real shading) as
 * their tunic/cart color, matching how Age of Empires-era games showed
 * ownership without recoloring the whole sprite. */

// Buildings render noticeably larger than units (a town center should dwarf a
// soldier standing next to it) - using a smaller scale for units, on top of
// their already-shorter ASCII art, keeps that size hierarchy readable even
// when a unit is standing right on its owner's building tile.
const BUILDING_SCALE = 4;
const UNIT_SCALE = 3;

export type StructureType = "base" | "farm" | "sawmill" | "barracks" | "market";
export type UnitType = "army" | "caravan";

const BUILDING_LEGEND: Legend = {
  O: OUTLINE,
  R: THATCH.mid,
  r: THATCH.light,
  W: WALL.mid,
  w: WALL.light,
  D: WOOD.dark,
  F: CROP.mid,
  f: CROP.light,
  L: WOOD.mid,
  l: WOOD.light,
  S: STONE.dark,
  M: STONE.mid,
  n: STONE.light,
  C: WOOD.mid,
  P: WOOD.mid,
};

const BUILDINGS: Record<StructureType, string[]> = {
  // Town center: a stone-footed cottage with a tapered thatch roof, a proud
  // flag, and a small (not cavernous) doorway.
  base: [
    "........$........",
    "........O........",
    ".......OOO.......",
    "......ORrRO......",
    ".....ORrRRRO.....",
    "....ORrRRRRRO....",
    "...OWWWWWWWWWO...",
    "..OWwWWWWWWWwWO..",
    ".OWWWWWWWWWWWWWO.",
    "OWWWWWWODDOWWWWWO",
    "OwWWWWWDDWWwWWWWO",
    "OWWWWWWWWWWWWWWWO",
    ".OOOOOOOOOOOOOOO.",
    "..SSSSSSSSSSSSS..",
  ],
  // Farm: fenced crop rows with a small accent-colored scarecrow watching.
  farm: [
    ".......$.......",
    ".......O.......",
    "......OOO......",
    ".....O$$$O.....",
    ".OOOOO...OOOOO.",
    "OFFFfFFFfFFFFFO",
    "OfFFFfFFFfFFFfO",
    "OFFFfFFFfFFFFFO",
    "OfFFFfFFFfFFFfO",
    "OFFFfFFFfFFFFFO",
    ".OOOOOOOOOOOOO.",
  ],
  // Sawmill: circular saw blade between a work shed and a stacked log pile.
  sawmill: [
    "........$......",
    "........O......",
    ".......OWO.....",
    "......OWWWO....",
    ".OOOOOOWWWOOOO.",
    "OWWWWWWWWWWWWWO",
    "OwWWW.nSn.WWWwO",
    "OWWWW.SMS.WWWWO",
    "OwWWW.nSn.WWWwO",
    "OWWWWWWWWWWWWWO",
    "OLLLLLLLLLLLLLO",
    "OlLlLlLlLlLlLlO",
    ".OOOOOOOOOOOOO.",
  ],
  // Barracks: twin-towered fort, a banner flying from each tower, one small
  // reinforced doorway (not a full black archway).
  barracks: [
    ".....$...$.....",
    ".....O...O.....",
    "....OOO.OOO....",
    "....OMSO.OSMO..",
    "...OOMOOOOMOO..",
    "..OWWWWWWWWWO..",
    ".OWwWWWWWWWwWO.",
    "OWWWWWWWWWWWWWO",
    "OwWWWWWDDWWWwWO",
    "OWWWWWWWWWWWWWO",
    ".OOOOOOOOOOOOO.",
  ],
  // Market: an open trade-post tent with a striped awning, visible wooden
  // support poles (not the near-invisible dark outline color), and goods on
  // display at the counter - deliberately the most "busy" building so it
  // reads as a place of commerce rather than another house. The poles are a
  // clearly-colored material so the tent and counter read as one structure
  // instead of two floating pieces against the dark background.
  market: [
    ".OOOOOOOOOOOO.",
    "O$W$W$W$W$WWO.",
    "O$W$W$W$W$WWO.",
    "OWWWWWWWWWWWWO",
    "P............P",
    "P.CCCCCCCCCC.P",
    "P.CfFfFfFfFC.P",
    "P.CCCCCCCCCC.P",
    "P............P",
    "PPPPPPPPPPPPPP",
  ],
};

const UNIT_LEGEND: Legend = {
  O: OUTLINE,
  e: OUTLINE,
  W: METAL,
  w: WOOD.dark,
  H: SKIN,
  B: WOOD.dark,
  "+": METAL,
};

const UNITS: Record<UnitType, string[]> = {
  // Soldier: a proper hilted sword (blade/crossguard/hilt, not just a line),
  // a face with visible eyes under the helmet, a cape draped past the
  // shoulders (the accent-shadow tone along the torso's outer edges), and
  // booted legs.
  army: [
    ".....OWO.....",
    ".....OWO.....",
    "....OWWWO....",
    ".....OwO.....",
    "....OOOOO....",
    "...OHHHHHO...",
    "...OHeHeHO...",
    "...OHHHHHO...",
    "...OOOOOOO...",
    "..O$$$$$$$O..",
    ".O@$$$$$$$@O.",
    ".O@$$%%%$$@O.",
    ".O$$O...O$$O.",
    "..OBO...OBO..",
    "..OBO...OBO..",
    ".sssssssssss.",
  ],
  // Covered wagon: light canopy top, shaded accent body, and two wheels
  // with visible spokes (an axle hub, not a plain circle) - reads as an
  // actual mechanism rather than a box on dots.
  caravan: [
    ".....OOO.....",
    "...O%%%%%O...",
    "..O$$$$$$$O..",
    "..O$@@@@@$O..",
    ".OOOOOOOOOOO.",
    ".............",
    ".OOO.....OOO.",
    "O.+.O...O.+.O",
    ".OOO.....OOO.",
    ".sssssssssss.",
  ],
};

export function getBuildingTexture(type: StructureType, accent: string): Texture {
  return getSpriteTexture(
    `building:${type}:${accent}`,
    sprite(BUILDINGS[type]),
    BUILDING_LEGEND,
    BUILDING_SCALE,
    accent,
  );
}

export function getUnitTexture(type: UnitType, accent: string): Texture {
  return getSpriteTexture(`unit:${type}:${accent}`, sprite(UNITS[type]), UNIT_LEGEND, UNIT_SCALE, accent);
}
