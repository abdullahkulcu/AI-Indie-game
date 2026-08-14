import { useEffect, useRef } from "react";
import { Application, Container, Graphics } from "pixi.js";
import type { GameStateSnapshot } from "../types";

const TILE_SIZE = 28;

const TERRAIN_COLORS: Record<string, number> = {
  plains: 0x3a5a40,
  forest: 0x1b4332,
  mountain: 0x6c757d,
  water: 0x1d3557,
};

const PLAYER_COLORS = [
  0xe63946, 0xf4a261, 0x2a9d8f, 0x457b9d, 0x9b5de5, 0xf15bb5, 0xfee440, 0x00bbf9,
];

function colorForPlayer(playerId: string, orderedPlayerIds: string[]): number {
  const idx = orderedPlayerIds.indexOf(playerId);
  return PLAYER_COLORS[idx % PLAYER_COLORS.length] ?? 0xffffff;
}

interface MapGridProps {
  snapshot: GameStateSnapshot | null;
  selfPlayerId: string | null;
  onTileClick?: (x: number, y: number) => void;
}

/** Simple clickable 2D grid renderer for the shared 20x20 map. Kept to plain
 * PixiJS primitives (no sprite atlas) - swapping in real art later only
 * touches this component. */
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

    app
      .init({
        width: mapSize * TILE_SIZE,
        height: mapSize * TILE_SIZE,
        backgroundColor: 0x0d1b2a,
        antialias: true,
      })
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

    const playerIds = snapshot.players.map((p) => p.id);

    for (const tile of snapshot.tiles) {
      const g = new Graphics();
      const baseColor = TERRAIN_COLORS[tile.terrain] ?? 0x3a5a40;
      g.rect(0, 0, TILE_SIZE - 1, TILE_SIZE - 1).fill(baseColor);
      if (tile.ownerPlayerId) {
        g.rect(0, 0, TILE_SIZE - 1, 4).fill(colorForPlayer(tile.ownerPlayerId, playerIds));
      }
      g.x = tile.x * TILE_SIZE;
      g.y = tile.y * TILE_SIZE;
      g.eventMode = "static";
      g.cursor = "pointer";
      g.on("pointertap", () => onTileClickRef.current?.(tile.x, tile.y));
      board.addChild(g);
    }

    for (const structure of snapshot.structures) {
      const g = new Graphics();
      g.rect(4, 4, TILE_SIZE - 9, TILE_SIZE - 9)
        .fill(colorForPlayer(structure.ownerPlayerId, playerIds))
        .stroke({ width: 1, color: 0xffffff });
      g.x = structure.x * TILE_SIZE;
      g.y = structure.y * TILE_SIZE;
      board.addChild(g);
    }

    for (const unit of snapshot.units) {
      if (unit.hp <= 0) continue;
      const g = new Graphics();
      const color = colorForPlayer(unit.ownerPlayerId, playerIds);
      const isSelf = unit.ownerPlayerId === selfPlayerId;
      const radius = unit.type === "army" ? 7 : 5;
      g.circle(TILE_SIZE / 2, TILE_SIZE / 2, radius)
        .fill(color)
        .stroke({ width: isSelf ? 2 : 1, color: 0xffffff });
      g.x = unit.x * TILE_SIZE;
      g.y = unit.y * TILE_SIZE;
      board.addChild(g);
    }
  }, [snapshot, selfPlayerId]);

  return <div ref={containerRef} className="map-grid" />;
}
