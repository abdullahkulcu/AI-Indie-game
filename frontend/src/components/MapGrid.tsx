import { useEffect, useRef } from "react";
import { Application, Container, Graphics, Sprite } from "pixi.js";
import type { GameStateSnapshot } from "../types";
import { colorForPlayer } from "../pixelart/palette";
import { TILE_PX_H, TILE_PX_W, getTileTexture } from "../pixelart/tiles";
import { getBuildingTexture, getUnitTexture } from "../pixelart/sprites";

const TILE_W = TILE_PX_W;
const TILE_H = TILE_PX_H;
const TOP_MARGIN = 90; // room for buildings/units poking up above row 0

function isoX(x: number, y: number): number {
  return (x - y) * (TILE_W / 2);
}

function isoY(x: number, y: number): number {
  return (x + y) * (TILE_H / 2);
}

/** Deterministic small per-id offset so multiple units standing on the exact
 * same tile (e.g. a fresh player's starting army + caravan) don't render
 * perfectly stacked on top of one another. */
function jitterFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 5) - 2; // -2..2
}

interface MapGridProps {
  snapshot: GameStateSnapshot | null;
  selfPlayerId: string | null;
  onTileClick?: (x: number, y: number) => void;
}

/** Isometric, pixel-art 2D map renderer (Age of Empires 1/2-style diamond
 * tiles) built from procedurally generated PixiJS textures - see
 * `src/pixelart/`. No image assets are loaded from disk; every sprite is
 * rasterized from ASCII pixel-art definitions the first time it's needed and
 * cached after that. */
export function MapGrid({ snapshot, selfPlayerId, onTileClick }: MapGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const boardRef = useRef<Container | null>(null);
  const onTileClickRef = useRef(onTileClick);
  onTileClickRef.current = onTileClick;

  useEffect(() => {
    let disposed = false;
    const app = new Application();
    const mapSize = snapshot?.mapSize ?? 20;
    const width = mapSize * TILE_W;
    const height = mapSize * TILE_H + TOP_MARGIN + TILE_H;

    app
      .init({ width, height, backgroundColor: 0x0d1b2a, antialias: false })
      .then(() => {
        if (disposed || !containerRef.current) {
          app.destroy(true, { children: true });
          return;
        }
        containerRef.current.appendChild(app.canvas);
        const board = new Container();
        app.stage.addChild(board);
        appRef.current = app;
        boardRef.current = board;
      });

    return () => {
      disposed = true;
      appRef.current?.destroy(true, { children: true });
      appRef.current = null;
      boardRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const board = boardRef.current;
    if (!board || !snapshot) return;
    board.removeChildren().forEach((child) => child.destroy());

    const mapSize = snapshot.mapSize;
    const originX = (mapSize * TILE_W) / 2;
    const originY = TOP_MARGIN;
    const playerIds = snapshot.players.map((p) => p.id);

    const groundLayer = new Container();
    const entityLayer = new Container();
    board.addChild(groundLayer, entityLayer);

    // Ground: draw order doesn't matter, each diamond's outside-shape pixels
    // are fully transparent so overlapping bounding boxes never clash.
    for (const tile of snapshot.tiles) {
      const texture = getTileTexture(tile.terrain);
      const tileSprite = new Sprite(texture);
      tileSprite.anchor.set(0.5, 0);
      tileSprite.x = originX + isoX(tile.x, tile.y);
      tileSprite.y = originY + isoY(tile.x, tile.y);
      groundLayer.addChild(tileSprite);

      if (tile.ownerPlayerId) {
        const claimMark = new Graphics();
        const accent = colorForPlayer(tile.ownerPlayerId, playerIds);
        claimMark
          .poly([0, TILE_H * 0.32, TILE_W * 0.12, TILE_H * 0.5, 0, TILE_H * 0.68, -TILE_W * 0.12, TILE_H * 0.5])
          .fill({ color: accent, alpha: 0.35 });
        claimMark.x = tileSprite.x;
        claimMark.y = tileSprite.y;
        groundLayer.addChild(claimMark);
      }

      const hit = new Graphics();
      hit
        .poly([0, 0, TILE_W / 2, TILE_H / 2, 0, TILE_H, -TILE_W / 2, TILE_H / 2])
        .fill({ color: 0xffffff, alpha: 0.001 });
      hit.x = tileSprite.x;
      hit.y = tileSprite.y;
      hit.eventMode = "static";
      hit.cursor = "pointer";
      hit.on("pointertap", () => onTileClickRef.current?.(tile.x, tile.y));
      groundLayer.addChild(hit);
    }

    // Entities (buildings + units) painter's-algorithm sorted back-to-front.
    type Entity = { depth: number; build: () => void };
    const entities: Entity[] = [];

    for (const structure of snapshot.structures) {
      const groundX = originX + isoX(structure.x, structure.y);
      const groundY = originY + isoY(structure.x, structure.y) + TILE_H * 0.5;
      entities.push({
        depth: structure.x + structure.y,
        build: () => {
          const accent = colorForPlayer(structure.ownerPlayerId, playerIds);
          const texture = getBuildingTexture(structure.type, accent);
          const buildingSprite = new Sprite(texture);
          buildingSprite.anchor.set(0.5, 1);
          buildingSprite.x = groundX;
          buildingSprite.y = groundY;
          entityLayer.addChild(buildingSprite);
        },
      });
    }

    for (const unit of snapshot.units) {
      if (unit.hp <= 0) continue;
      // Small deterministic jitter so multiple units sharing a tile (e.g. two
      // idle units guarding the same spot) don't render perfectly stacked.
      const jitter = jitterFor(unit.id) * 6;
      const groundX = originX + isoX(unit.x, unit.y) + jitter;
      const groundY = originY + isoY(unit.x, unit.y) + TILE_H * 0.6;
      entities.push({
        depth: unit.x + unit.y + 0.5, // units render just in front of a building on the same tile
        build: () => {
          const accent = colorForPlayer(unit.ownerPlayerId, playerIds);
          const texture = getUnitTexture(unit.type, accent);
          const unitSprite = new Sprite(texture);
          unitSprite.anchor.set(0.5, 1);
          unitSprite.x = groundX;
          unitSprite.y = groundY;
          entityLayer.addChild(unitSprite);

          if (unit.ownerPlayerId === selfPlayerId) {
            const marker = new Graphics();
            marker.poly([-5, -4, 5, -4, 0, 4]).fill({ color: 0xfee440 });
            marker.x = groundX;
            marker.y = groundY - unitSprite.height - 6;
            entityLayer.addChild(marker);
          }

          if (unit.hp < unit.maxHp) {
            const barWidth = 24;
            const barBack = new Graphics();
            barBack.rect(-barWidth / 2, 0, barWidth, 4).fill({ color: 0x10141a });
            const barFront = new Graphics();
            const ratio = Math.max(0, unit.hp / unit.maxHp);
            barFront.rect(-barWidth / 2, 0, barWidth * ratio, 4).fill({ color: ratio > 0.4 ? 0x2a9d8f : 0xe63946 });
            barBack.x = groundX;
            barBack.y = groundY - unitSprite.height - 12;
            barFront.x = barBack.x;
            barFront.y = barBack.y;
            entityLayer.addChild(barBack, barFront);
          }
        },
      });
    }

    entities
      .sort((a, b) => a.depth - b.depth)
      .forEach((entity) => entity.build());
  }, [snapshot, selfPlayerId]);

  return <div ref={containerRef} className="map-grid" />;
}
