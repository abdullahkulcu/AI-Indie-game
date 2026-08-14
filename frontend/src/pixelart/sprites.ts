import type { Texture } from "pixi.js";
import { getSpriteTexture, sprite, type Legend } from "./asciiSprite";
import { CROP, METAL, OUTLINE, SKIN, SKIN_SHADOW, STONE, THATCH, WALL, WOOD } from "./palette";

/** Building and unit art: a top-down, flat "sandbox sim" look (WorldBox-style)
 * rather than an isometric RTS one - simple square buildings and small
 * round-headed chibi units, all with a thick dark outline and few internal
 * shading tones. Defined as compact ASCII pixel-art ("big pixel" per
 * character) and rasterized on demand. "$"/"@"/"%" are reserved for the
 * owning player's accent color and its auto-derived dark/light shades (see
 * asciiSprite.ts) - buildings stay in neutral materials with a colored
 * flag, units wear the accent as their tunic/cart color. */

// Buildings render larger than units so a town center still reads as bigger
// than the little people standing near it.
const BUILDING_SCALE = 4;
const UNIT_SCALE = 3;

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
  S: STONE.dark,
  M: STONE.mid,
  n: STONE.light,
  C: WOOD.mid,
  P: WOOD.mid,
};

const BUILDINGS: Record<StructureType, string[]> = {
  // Town center: a simple flat-topped cottage with a proud little flag.
  base: [
    ".....$.....",
    ".....O.....",
    "....OOO....",
    "...ORRRO...",
    "..ORRRRRO..",
    ".OWWWWWWWO.",
    "OWWWWWWWWWO",
    "OWWWWDDWWWO",
    "OWWWWDDWWWO",
    "OWWWWWWWWWO",
    ".OOOOOOOOO.",
  ],
  // Farm: a small fenced crop plot with a flag post.
  farm: [
    "....$....",
    "....O....",
    ".OOOOOOO.",
    "OFFfFFfFO",
    "OfFFfFFfO",
    "OFFfFFfFO",
    "OfFFfFFfO",
    ".OOOOOOO.",
  ],
  // Sawmill: a circular saw blade between a small shed and a log pile.
  sawmill: [
    "....$....",
    "....O....",
    "...OWO...",
    "..OWWWO..",
    ".OWWWWWO.",
    "OW.nSn.WO",
    "OW.SMS.WO",
    "OW.nSn.WO",
    "OWWWWWWWO",
    "OLLLLLLLO",
    ".OOOOOOO.",
  ],
  // Barracks: a small fort with two corner towers, each flying a banner.
  barracks: [
    "..$...$..",
    "..O...O..",
    ".OOO.OOO.",
    ".OSO.OSO.",
    "OOWWWWWOO",
    "OWWWWWWWO",
    "OWWWDDWWO",
    "OWWWWWWWO",
    ".OOOOOOO.",
  ],
  // Market: an open trade-post tent with a striped awning on visible posts
  // over a goods counter - the busiest-looking building, for commerce.
  market: [
    ".OOOOOOO.",
    "O$W$W$WO.",
    "OWWWWWWWO",
    "P.......P",
    "P.CCCCC.P",
    "P.CfFfC.P",
    "P.CCCCC.P",
    "P.......P",
    "PPPPPPPPP",
  ],
};

const UNIT_LEGEND: Legend = {
  O: OUTLINE,
  e: OUTLINE,
  W: METAL,
  H: SKIN,
  h: SKIN_SHADOW,
  B: WOOD.dark,
};

const UNITS: Record<UnitType, string[]> = {
  // A small chibi soldier: big round head with two dot eyes, a shaded tunic,
  // and stubby legs - a tiny spear tip on top marks it as military.
  army: [
    "....OWO....",
    "...OOOOO...",
    "..OHHHHHO..",
    "..OHeHeHO..",
    "..OHHHHHO..",
    "..OOOOOOO..",
    ".O$$$$$$$O.",
    "O$$@@@@@$$O",
    "O$$$%%%$$$O",
    ".O$$O.O$$O.",
    "..OBO.OBO..",
    ".sssssssss.",
  ],
  // A small covered wagon: light canopy dome, shaded accent body, two round
  // wheels.
  caravan: [
    "....OOOOO....",
    "...O%%%%%O...",
    "..O$$$$$$$O..",
    "..O$@@@@@$O..",
    "..OOOOOOOOO..",
    "....O...O....",
    "...OOO.OOO...",
    "....O...O....",
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
