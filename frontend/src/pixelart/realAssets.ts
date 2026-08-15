/** Loader for real, user-supplied pixel-art asset files (see
 * frontend/assets-source/ for the original sprite sheets they were sliced
 * from). Images are fetched from `public/assets/...` and cached as plain
 * `HTMLImageElement`s - tiles.ts/sprites.ts draw them onto a canvas (so they
 * can still be clipped to a diamond, layered with procedural decorations,
 * etc.) instead of relying on PixiJS's own loader.
 *
 * Loading is fire-and-forget at module init: `getRealAsset` returns null
 * until an image finishes loading, and callers fall back to the procedural
 * painter for that one call. Textures are cache-keyed so once the image is
 * ready, the very next call picks it up automatically - see the `:asset`
 * suffix used in tiles.ts/sprites.ts cache keys. */

const cache = new Map<string, HTMLImageElement>();

function loadImage(key: string, src: string): void {
  const img = new Image();
  img.src = src;
  cache.set(key, img);
}

loadImage("tile:plains", "/assets/tiles/plains.png");
loadImage("tile:mountain", "/assets/tiles/mountain.png");
loadImage("tile:water", "/assets/tiles/water.png");
loadImage("tile:desert", "/assets/tiles/desert.png");
loadImage("unit:army", "/assets/units/army.png");

export function getRealAsset(key: string): HTMLImageElement | null {
  const img = cache.get(key);
  if (img && img.complete && img.naturalWidth > 0) return img;
  return null;
}
