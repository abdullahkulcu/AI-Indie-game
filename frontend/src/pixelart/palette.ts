/** Shared color palette for the procedural pixel-art renderer. Kept small and
 * muted on purpose - old isometric strategy games (Age of Empires 1/2) leaned
 * on a handful of earthy tones plus one bright "ownership" accent per player. */

export const OUTLINE = "#10141a";
export const SHADOW = "rgba(6, 10, 16, 0.4)";

export const GRASS = { dark: "#2f4a34", mid: "#3a5a40", light: "#4f7452" };
export const DIRT = { dark: "#4a3623", mid: "#6b4f3a", light: "#84654a" };
// Stronghold Crusader-style desert sand, the dominant region tone.
export const SAND = { dark: "#c8a668", mid: "#dcbf87", light: "#ecd6a6" };
export const STONE = { dark: "#495057", mid: "#6c757d", light: "#9099a1" };
export const WATER = { dark: "#16294a", mid: "#1d3557", light: "#2a4d7a", foam: "#6ea8d8" };

export const WOOD = { dark: "#5c3a1a", mid: "#8b5a2b", light: "#a97844" };
export const THATCH = { dark: "#6e4b1f", mid: "#9c7124", light: "#c79a3d" };
// Warm plaster/timber wall tone - deliberately far from STONE/METAL's cool
// grays so buildings read as cozy cottages, not silvery blobs.
export const WALL = { dark: "#8a7355", mid: "#c2a878", light: "#e6d2a8" };
export const SKIN = "#e8b98a";
export const SKIN_SHADOW = "#c9976a";
export const METAL = "#aeb4bd";
export const CROP = { dark: "#a3821a", mid: "#d4a017", light: "#e8c04a" };
export const LEAVES = { dark: "#173d2d", mid: "#1b4332", light: "#2d6a4f" };

export const PLAYER_COLORS = [
  "#e63946",
  "#f4a261",
  "#2a9d8f",
  "#457b9d",
  "#9b5de5",
  "#f15bb5",
  "#fee440",
  "#00bbf9",
];

export function colorForPlayer(playerId: string, orderedPlayerIds: string[]): string {
  const idx = orderedPlayerIds.indexOf(playerId);
  return PLAYER_COLORS[idx % PLAYER_COLORS.length] ?? "#e9ecef";
}
