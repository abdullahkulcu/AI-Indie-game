/** Shared color palette for the procedural pixel-art renderer. Bright and
 * cheerful, top-down sandbox-sim style (WorldBox) rather than a muted
 * historical RTS: flat, saturated terrain plus one bold "ownership" accent
 * per player, thick dark outlines on every character/building. */

export const OUTLINE = "#10141a";
export const SHADOW = "rgba(6, 10, 16, 0.4)";

export const GRASS = { dark: "#3f8a4c", mid: "#4fae5e", light: "#6bc471" };
export const DIRT = { dark: "#4a3623", mid: "#6b4f3a", light: "#84654a" };
export const STONE = { dark: "#5a6672", mid: "#7d8a97", light: "#a3b0bb" };
export const SNOW = "#f1f6f9";
export const WATER = { dark: "#1b5fa8", mid: "#2f8ce0", light: "#57aaf0", foam: "#bfe6ff" };

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
