import { useEffect, useRef } from "react";
import { Application, Container, Graphics, Sprite } from "pixi.js";
import type { GameStateSnapshot } from "../types";
import { colorForPlayer } from "../pixelart/palette";
import { TILE_PX_H, TILE_PX_W, getTileTexture } from "../pixelart/tiles";
import { getBuildingTexture, getUnitTexture } from "../pixelart/sprites";
import { terrainFor } from "../game/terrainMap";

const TILE_W = TILE_PX_W;
const TILE_H = TILE_PX_H;
const TOP_MARGIN = 90; // room for buildings/units poking up above the top row
/** How many tiles are visible around the camera in each direction - the map
 * itself is up to 500x500, but only this window is ever built into sprites.
 * Kept smaller than before since tiles now render at a bigger pixel size. */
const VIEW_RADIUS = 7;
/** Fixed "accent" for ownerless mob units - matches the hostile tone drawn in
 * sprites.ts (MOB_TONE.mid) so mobs never need a real player color. */
const MOB_ACCENT = "#5a4636";

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
 * `src/pixelart/`. The map itself can be up to 500x500 tiles, so this only
 * ever builds sprites for a small pannable window (VIEW_RADIUS around a
 * camera position) - ground terrain for that window is computed locally
 * (src/game/terrainMap.ts mirrors the backend's deterministic generator)
 * rather than fetched, so panning never needs a network round trip. */
export function MapGrid({ snapshot, selfPlayerId, onTileClick }: MapGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const boardRef = useRef<Container | null>(null);
  const onTileClickRef = useRef(onTileClick);
  onTileClickRef.current = onTileClick;

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const selfPlayerIdRef = useRef(selfPlayerId);
  selfPlayerIdRef.current = selfPlayerId;

  const camera = useRef({ x: 0, y: 0, initialized: false });
  const drawRef = useRef<() => void>(() => undefined);

  const canvasWidth = (VIEW_RADIUS * 2 + 1) * TILE_W;
  const canvasHeight = (VIEW_RADIUS * 2 + 1) * TILE_H + TOP_MARGIN + TILE_H;

  useEffect(() => {
    let disposed = false;
    const app = new Application();

    app
      .init({ width: canvasWidth, height: canvasHeight, backgroundColor: 0x0d1b2a, antialias: true })
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
        drawRef.current();
      });

    return () => {
      disposed = true;
      appRef.current?.destroy(true, { children: true });
      appRef.current = null;
      boardRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pan(dx: number, dy: number): void {
    const snap = snapshotRef.current;
    const mapSize = snap?.mapSize ?? 500;
    camera.current.x = Math.max(0, Math.min(mapSize - 1, camera.current.x + dx));
    camera.current.y = Math.max(0, Math.min(mapSize - 1, camera.current.y + dy));
    drawRef.current();
  }

  useEffect(() => {
    drawRef.current = () => {
      const board = boardRef.current;
      const snap = snapshotRef.current;
      if (!board || !snap) return;
      board.removeChildren().forEach((child) => child.destroy());

      if (!camera.current.initialized) {
        const ownStructure = snap.structures.find((s) => s.ownerPlayerId === selfPlayerIdRef.current);
        const ownUnit = snap.units.find((u) => u.ownerPlayerId === selfPlayerIdRef.current);
        const anchor = ownStructure ?? ownUnit;
        camera.current.x = anchor?.x ?? Math.floor(snap.mapSize / 2);
        camera.current.y = anchor?.y ?? Math.floor(snap.mapSize / 2);
        camera.current.initialized = true;
      }
      const { x: cx, y: cy } = camera.current;

      const originX = canvasWidth / 2 - isoX(cx, cy);
      const originY = canvasHeight / 2 - isoY(cx, cy) - TILE_H / 2;
      const playerIds = snap.players.map((p) => p.id);
      const claims = new Map(snap.tiles.map((t) => [`${t.x}:${t.y}`, t.ownerPlayerId]));

      const groundLayer = new Container();
      const entityLayer = new Container();
      board.addChild(groundLayer, entityLayer);

      const minX = Math.max(0, cx - VIEW_RADIUS);
      const maxX = Math.min(snap.mapSize - 1, cx + VIEW_RADIUS);
      const minY = Math.max(0, cy - VIEW_RADIUS);
      const maxY = Math.min(snap.mapSize - 1, cy + VIEW_RADIUS);

      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          const terrain = terrainFor(snap.seed, x, y);
          const texture = getTileTexture(terrain);
          const tileSprite = new Sprite(texture);
          tileSprite.anchor.set(0.5, 0);
          tileSprite.x = originX + isoX(x, y);
          tileSprite.y = originY + isoY(x, y);
          groundLayer.addChild(tileSprite);

          const ownerPlayerId = claims.get(`${x}:${y}`);
          if (ownerPlayerId) {
            const accent = colorForPlayer(ownerPlayerId, playerIds);
            const claimMark = new Graphics();
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
          hit.on("pointertap", () => onTileClickRef.current?.(x, y));
          groundLayer.addChild(hit);
        }
      }

      // Entities (buildings + units) painter's-algorithm sorted back-to-front,
      // filtered to the visible window.
      type Entity = { depth: number; build: () => void };
      const entities: Entity[] = [];
      const inView = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;

      for (const structure of snap.structures) {
        if (!inView(structure.x, structure.y)) continue;
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

      for (const unit of snap.units) {
        if (unit.hp <= 0 || !inView(unit.x, unit.y)) continue;
        const jitter = jitterFor(unit.id) * 6;
        const groundX = originX + isoX(unit.x, unit.y) + jitter;
        const groundY = originY + isoY(unit.x, unit.y) + TILE_H * 0.6;
        entities.push({
          depth: unit.x + unit.y + 0.5, // units render just in front of a building on the same tile
          build: () => {
            const accent = unit.ownerPlayerId ? colorForPlayer(unit.ownerPlayerId, playerIds) : MOB_ACCENT;
            const texture = getUnitTexture(unit.type, accent);
            const unitSprite = new Sprite(texture);
            unitSprite.anchor.set(0.5, 1);
            unitSprite.x = groundX;
            unitSprite.y = groundY;
            entityLayer.addChild(unitSprite);

            if (unit.ownerPlayerId === selfPlayerIdRef.current) {
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
              barFront
                .rect(-barWidth / 2, 0, barWidth * ratio, 4)
                .fill({ color: ratio > 0.4 ? 0x2a9d8f : 0xe63946 });
              barBack.x = groundX;
              barBack.y = groundY - unitSprite.height - 12;
              barFront.x = barBack.x;
              barFront.y = barBack.y;
              entityLayer.addChild(barBack, barFront);
            }
          },
        });
      }

      entities.sort((a, b) => a.depth - b.depth).forEach((entity) => entity.build());
    };

    drawRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, selfPlayerId]);

  // Click-and-drag panning.
  const dragState = useRef<{ lastX: number; lastY: number } | null>(null);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    dragState.current = { lastX: event.clientX, lastY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragState.current) return;
    const dxScreen = event.clientX - dragState.current.lastX;
    const dyScreen = event.clientY - dragState.current.lastY;
    if (dxScreen === 0 && dyScreen === 0) return;
    dragState.current = { lastX: event.clientX, lastY: event.clientY };

    // Inverse of isoX/isoY: convert a screen-space drag into a world-space
    // tile shift, moved opposite to the drag (grab-and-move-the-map feel).
    const tdx = (-dxScreen / (TILE_W / 2) + -dyScreen / (TILE_H / 2)) / 2;
    const tdy = (-dyScreen / (TILE_H / 2) - -dxScreen / (TILE_W / 2)) / 2;
    pan(tdx, tdy);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    dragState.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div className="map-grid-wrap">
      <div
        ref={containerRef}
        className="map-grid"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <div className="map-pan-controls">
        <button className="map-pan-controls__n" onClick={() => pan(-5, -5)} aria-label="Kuzey">
          ▲
        </button>
        <button className="map-pan-controls__w" onClick={() => pan(-5, 5)} aria-label="Bati">
          ◀
        </button>
        <button className="map-pan-controls__e" onClick={() => pan(5, -5)} aria-label="Dogu">
          ▶
        </button>
        <button className="map-pan-controls__s" onClick={() => pan(5, 5)} aria-label="Guney">
          ▼
        </button>
      </div>
    </div>
  );
}
