/**
 * Sahne kurgusu: DTO → 3B dünya.
 *
 * Referans mockup'ta her yapı elle yerleştirilmişti. Burada aynı görsel dil
 * korunuyor ama yerleşim veriden çıkıyor: Kale seviyesi kalenin yüksekliğini ve
 * mazgallarını, Sur seviyesi duvar parçalarını, her ekonomi/askeri bina kendi
 * slotundaki yapıyı doğuruyor. Komşular ve ilişki ağı `RealmViewDto`den geliyor.
 *
 * Veri yoksa (giriş öncesi) referansın demo yerleşimi kurulur — sahne hiçbir
 * zaman boş görünmez.
 */

import * as THREE from 'three';
import type { BuildingDto, BuildingType, KingdomStateDto, RealmViewDto, TerrainType } from '@krallik/shared';
import { BUILDINGS } from '@krallik/shared';
import {
  PALETTE,
  addBox,
  addBuilding,
  addCone,
  addCylinder,
  addPlane,
  crenellate,
  makeAridPlain,
  makeArcheryRange,
  makeChapel,
  makeContestedMarker,
  makeDistantKingdom,
  makeDock,
  makeFarmPlot,
  makeFigure,
  makeForestPatch,
  makeFoundry,
  makeGranary,
  makeMarket,
  makeMill,
  makeMountainRange,
  makeNetworkLine,
  makeQuarryPit,
  makeRiver,
  makeStable,
  makeTownSquare,
  makeTradeCart,
  makeWatchtower,
} from './builders';
import type { LabelAnchor, TradeCart } from './builders';

/** Bir harita tile'ının dünya birimi karşılığı. */
const TILE_WORLD = 7;
/** Komşu krallıkların merkeze en yakın/uzak durabileceği mesafe. */
const NEIGHBOR_MIN_RADIUS = 32;
const NEIGHBOR_MAX_RADIUS = 88;
/** Arazi özelliklerinde çizilecek azami tile sayısı (kare sayısını sınırlar). */
const MAX_TERRAIN_TILES = 90;

export interface Villager {
  mesh: THREE.Object3D;
  baseX: number;
  baseZ: number;
  phase: number;
  speed: number;
}

export interface BuiltWorld {
  root: THREE.Group;
  /** Yakın plan detayları — `camera.zoom > 0.5` iken görünür. */
  detailGroup: THREE.Group;
  blades: THREE.Group[];
  villagers: Villager[];
  carts: TradeCart[];
  networkLines: THREE.Line[];
  distantLabels: LabelAnchor[];
  geoLabels: LabelAnchor[];
  levelBadges: LabelAnchor[];
  torchPositions: THREE.Vector3[];
}

function emptyWorld(root: THREE.Group, detailGroup: THREE.Group): BuiltWorld {
  return {
    root,
    detailGroup,
    blades: [],
    villagers: [],
    carts: [],
    networkLines: [],
    distantLabels: [],
    geoLabels: [],
    levelBadges: [],
    torchPositions: [],
  };
}

// --------------------------------------------------------------- Bina slotları

/**
 * Her bina tipinin başkent düzlemindeki adayları. Çok kopyalı binalar
 * (`MULTI_INSTANCE_BUILDINGS`) sırayla bir sonraki slotu kullanır; slotlar
 * biterse yapı çizilmez — kalabalık bir başkentte üst üste binme olmasın.
 */
const SLOTS: Partial<Record<BuildingType, readonly (readonly [number, number])[]>> = {
  wheat_farm: [
    [-8, 7],
    [-5, 10],
    [-11, 10],
  ],
  apple_orchard: [
    [-13, 4],
    [-14, 8],
  ],
  mill: [[10, 2]],
  bakery: [[8, 5.5]],
  hops_farm: [[-7, 13]],
  brewery: [[5, 13]],
  dairy_farm: [[-12, -3]],
  cheesemaker: [[-9, -3.5]],
  quarry: [
    [13, -8],
    [15.5, -4.5],
  ],
  mine: [
    [12.5, -12.5],
    [15.5, -15],
  ],
  foundry: [[-6, -7]],
  woodcutter: [
    [-14, -9],
    [-12, -12.5],
  ],
  market: [[0, 13]],
  granary: [[6, 9]],
  barracks: [[9, -8]],
  archery_range: [[13, -3]],
  stable: [[-9, 1]],
  armory: [[7.5, -5]],
  siege_workshop: [[11, 6]],
  tower: [
    [-4.5, -4.5],
    [4.5, -4.5],
    [-4.5, 4.5],
    [4.5, 4.5],
  ],
  town_square: [[3, 6]],
  chapel: [[6, -1]],
};

function slotFor(type: BuildingType, index: number): readonly [number, number] | null {
  const list = SLOTS[type];
  if (!list) return null;
  return list[index % list.length] ?? null;
}

/** Bir binanın gövdesini tipine göre çizer. */
function placeBuilding(
  parent: THREE.Object3D,
  detail: THREE.Object3D,
  type: BuildingType,
  level: number,
  x: number,
  z: number,
  out: { blades: THREE.Group[] },
): void {
  switch (type) {
    case 'wheat_farm':
    case 'hops_farm':
      makeFarmPlot(detail, x, z);
      break;
    case 'apple_orchard':
      makeForestPatch(detail, [
        [x, z],
        [x + 1.6, z + 1.2],
        [x - 1.5, z + 1.4],
      ]);
      break;
    case 'mill':
      out.blades.push(makeMill(parent, x, z));
      break;
    case 'bakery':
      addBuilding(parent, x, z, 2.4, 2, 1.6, 1.4, PALETTE.STONE_LIGHT, PALETTE.ROOF_WINE);
      addCylinder(parent, 0.15, 0.15, 1.2, 8, 0x2e2b28, x + 0.8, 2.2, z);
      break;
    case 'brewery':
      addBuilding(parent, x, z, 2.6, 2.2, 1.8, 1.5, PALETTE.WOOD, PALETTE.ROOF_GOLD);
      addCylinder(parent, 0.5, 0.5, 0.9, 10, PALETTE.WOOD_DARK, x + 1.8, 0.45, z + 0.8);
      break;
    case 'dairy_farm':
      addBuilding(parent, x, z, 2.4, 2, 1.4, 1.2, PALETTE.WOOD, PALETTE.ROOF_BLUE);
      break;
    case 'cheesemaker':
      addBuilding(parent, x, z, 2.2, 1.8, 1.5, 1.3, PALETTE.STONE_LIGHT, PALETTE.SLATE);
      break;
    case 'quarry':
      makeQuarryPit(parent, x, z, 0x8d8377);
      break;
    case 'mine':
      makeQuarryPit(parent, x, z, 0x6b5f52);
      addBuilding(parent, x + 1.6, z - 1.4, 1.6, 1.4, 1.1, 0.9, PALETTE.WOOD_DARK, PALETTE.SLATE);
      break;
    case 'foundry':
    case 'armory':
      makeFoundry(parent, x, z);
      break;
    case 'woodcutter':
      addBuilding(parent, x, z, 1.8, 1.6, 1.2, 1.1, PALETTE.WOOD_DARK, PALETTE.ROOF_WINE);
      makeForestPatch(detail, [
        [x + 2, z + 1.4],
        [x - 1.8, z + 2],
      ]);
      break;
    case 'market':
      makeMarket(parent, x, z);
      break;
    case 'granary':
      makeGranary(parent, x, z);
      break;
    case 'barracks':
      addBuilding(parent, x, z, 3.2, 2.2, 1.8, 1.6, PALETTE.WOOD, PALETTE.ROOF_WINE, Math.PI / 8);
      break;
    case 'archery_range':
      makeArcheryRange(parent, x, z);
      break;
    case 'stable':
      makeStable(parent, x, z);
      break;
    case 'siege_workshop':
      addBuilding(parent, x, z, 3, 2.6, 1.6, 1.2, PALETTE.WOOD_DARK, PALETTE.SLATE);
      addCylinder(parent, 0.3, 0.3, 0.2, 10, PALETTE.WOOD, x + 1.8, 0.2, z + 1);
      break;
    case 'tower':
      makeWatchtower(parent, x, z, level);
      break;
    case 'town_square':
      makeTownSquare(parent, x, z);
      break;
    case 'chapel':
      makeChapel(parent, x, z);
      break;
    default:
      // Sur/hendek/kapı/kale yapısal olarak ayrıca kuruluyor.
      break;
  }
}

// ------------------------------------------------------------------ Kale + sur

function buildKeep(parent: THREE.Object3D, level: number): void {
  const height = 3 + level * 0.7;
  addCylinder(parent, 2.2, 2.2, height, 16, PALETTE.STONE, 0, height / 2, 0);
  addCone(parent, 2.7, 2.6, 16, PALETTE.ROOF_WINE, 0, height + 1.3, 0);
  // Sv.4'ten itibaren kalenin kendi mazgalları belirir.
  if (level >= 4) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      addBox(parent, 0.4, 0.4, 0.4, PALETTE.STONE_DARK, Math.cos(a) * 2.1, height + 0.2, Math.sin(a) * 2.1);
    }
  }
}

/**
 * Sur: seviye yüksekliği ve mazgal sıklığını belirler. Güney cephesi kapı için
 * ikiye bölünür — referanstaki düzenin aynısı.
 */
function buildWalls(parent: THREE.Object3D, level: number, hasGate: boolean): void {
  const h = 1.8 + level * 0.28;
  const y = h / 2;
  addBox(parent, 0.6, h, 9, PALETTE.STONE_DARK, -4.5, y, 0);
  addBox(parent, 0.6, h, 9, PALETTE.STONE_DARK, 4.5, y, 0);
  addBox(parent, 9, h, 0.6, PALETTE.STONE_DARK, 0, y, -4.5);
  addBox(parent, 3.2, h, 0.6, PALETTE.STONE_DARK, -3.0, y, 4.5);
  addBox(parent, 3.2, h, 0.6, PALETTE.STONE_DARK, 3.0, y, 4.5);

  const top = h + 0.2;
  crenellate(parent, -4.5, 0, 9, 'z', top);
  crenellate(parent, 4.5, 0, 9, 'z', top);
  crenellate(parent, 0, -4.5, 9, 'x', top);
  crenellate(parent, -3.0, 4.5, 3.2, 'x', top);
  crenellate(parent, 3.0, 4.5, 3.2, 'x', top);

  if (hasGate) {
    addBox(parent, 1.8, h * 0.9, 0.5, PALETTE.WOOD_DARK, 0, (h * 0.9) / 2, 4.5);
    addBox(parent, 0.4, h + 0.6, 0.7, PALETTE.STONE, -1.1, (h + 0.6) / 2, 4.5);
    addBox(parent, 0.4, h + 0.6, 0.7, PALETTE.STONE, 1.1, (h + 0.6) / 2, 4.5);
  }
}

function buildMoat(parent: THREE.Object3D, level: number): void {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(6.4, 6.4 + 0.5 + level * 0.25, 32),
    new THREE.MeshLambertMaterial({ color: PALETTE.WATER, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, 0.04, 0);
  parent.add(ring);
}

// ---------------------------------------------------------------- Yardımcılar

function levelLabel(b: BuildingDto): string {
  const name = BUILDINGS[b.type].nameTr;
  return b.upgradingToLevel
    ? `${name} Sv.${b.level}→${b.upgradingToLevel}`
    : `${name} Sv.${b.level}`;
}

function relationTint(relation: string): number {
  if (relation === 'war') return PALETTE.ROOF_WINE;
  if (relation === 'ally' || relation === 'protector') return PALETTE.TEAL;
  if (relation === 'vassal') return PALETTE.ROOF_GOLD;
  return PALETTE.STONE;
}

function edgeColor(kind: string): number {
  switch (kind) {
    case 'hostility':
      return PALETTE.WINE_LIGHT;
    case 'alliance':
      return 0x5aa393;
    case 'protection':
      return PALETTE.TEAL;
    default:
      return PALETTE.BRASS_LIGHT;
  }
}

const TERRAIN_FEATURE_LABEL: Partial<Record<TerrainType, string>> = {
  mountain: 'Dağ Silsilesi',
  forest: 'Yeşil Orman',
  riverbank: 'Büyük Nehir',
  barren: 'Kıraç Ova',
  pass: 'Geçit',
};

/** Bir tile'ın (harita koordinatı) dünya konumu; başkent orijindedir. */
function tileToWorld(tx: number, ty: number, selfX: number, selfY: number): [number, number] {
  return [(tx - selfX) * TILE_WORLD, (ty - selfY) * TILE_WORLD];
}

// ---------------------------------------------------------------- Ana kurulum

export function buildWorld(kingdom: KingdomStateDto | null, realm: RealmViewDto | null): BuiltWorld {
  const root = new THREE.Group();
  const detailGroup = new THREE.Group();
  root.add(detailGroup);
  const world = emptyWorld(root, detailGroup);

  // Zemin, nehir ve yol — referanstaki taban katman.
  addPlane(root, 220, 220, PALETTE.GRASS, 0, 0, 0);
  addPlane(root, 2.6, 18, PALETTE.WOOD, 0, 0.015, 9);

  if (!kingdom || !realm) {
    buildDemoWorld(world);
    return world;
  }

  const capitalTerrain = kingdom.capitalTerrain;
  if (capitalTerrain === 'riverbank') {
    makeRiver(root, -13, 0, 5, 40);
    makeDock(root, -13, -2);
  }

  // --- Kale, sur, hendek --------------------------------------------------
  const wall = kingdom.buildings.find((b) => b.type === 'wall');
  const moat = kingdom.buildings.find((b) => b.type === 'moat');
  const gate = kingdom.buildings.find((b) => b.type === 'gate');
  const keep = kingdom.buildings.find((b) => b.type === 'keep');

  buildKeep(root, kingdom.keepLevel);
  if (wall) buildWalls(root, wall.level, Boolean(gate));
  if (moat) buildMoat(root, moat.level);

  // Kapı önündeki nöbetçiler (referanstaki iki mızrakçı).
  makeFigure(root, -1.5, 5.3, PALETTE.ROOF_BLUE, true, Math.PI);
  makeFigure(root, 1.5, 5.3, PALETTE.ROOF_BLUE, true, Math.PI);
  world.torchPositions.push(new THREE.Vector3(-1.6, 1.8, 4.6), new THREE.Vector3(1.6, 1.8, 4.6));

  // --- Diğer binalar ------------------------------------------------------
  const seenPerType = new Map<BuildingType, number>();
  for (const building of kingdom.buildings) {
    if (building.type === 'keep' || building.type === 'wall' || building.type === 'moat' || building.type === 'gate') {
      continue;
    }
    const index = seenPerType.get(building.type) ?? 0;
    seenPerType.set(building.type, index + 1);
    const slot = slotFor(building.type, index);
    if (!slot) continue;
    placeBuilding(root, detailGroup, building.type, building.level, slot[0], slot[1], world);
  }

  // --- Seviye rozetleri ---------------------------------------------------
  const keepBadge = keep
    ? levelLabel(keep)
    : `Kale Sv.${kingdom.keepLevel}`;
  world.levelBadges.push({ worldPos: new THREE.Vector3(0, 5 + kingdom.keepLevel * 0.7 + 1.5, 0), text: keepBadge });
  if (wall) {
    world.levelBadges.push({ worldPos: new THREE.Vector3(0, 3.4, -4.5), text: levelLabel(wall) });
  }
  for (const building of kingdom.buildings) {
    if (world.levelBadges.length >= 8) break;
    if (building.type === 'keep' || building.type === 'wall') continue;
    // Yalnızca yükseltilenler ve ambar rozet alır; hepsini göstermek sahneyi boğar.
    const worthy = building.upgradingToLevel !== null || building.type === 'granary';
    if (!worthy) continue;
    const index = 0;
    const slot = slotFor(building.type, index);
    if (!slot) continue;
    world.levelBadges.push({
      worldPos: new THREE.Vector3(slot[0], 4.2, slot[1]),
      text: levelLabel(building),
    });
  }

  // --- Köylüler (yakın plan hareketi) -------------------------------------
  const villagerSpots: readonly (readonly [number, number, number, number, number])[] = [
    [2, 12, PALETTE.WOOD, 0, 0.5],
    [-7, 7.5, 0x9a7a45, 2, 0.4],
    [6.6, -1.6, 0x6b5b3a, 4, 0.6],
  ];
  for (const [vx, vz, color, phase, speed] of villagerSpots) {
    const mesh = makeFigure(detailGroup, vx, vz, color, false, 0);
    world.villagers.push({ mesh, baseX: vx, baseZ: vz, phase, speed });
  }

  // --- Komşular ve ilişki ağı ---------------------------------------------
  const positions = new Map<string, { x: number; z: number }>();
  positions.set(realm.self.id, { x: 0, z: 0 });

  for (const neighbor of realm.neighbors) {
    let [nx, nz] = tileToWorld(neighbor.x, neighbor.y, realm.self.x, realm.self.y);
    const len = Math.hypot(nx, nz);
    if (len < 0.001) {
      // Aynı koordinat (veri eksikse): rastgele değil, deterministik bir açıya koy.
      const angle = (positions.size * Math.PI * 2) / Math.max(1, realm.neighbors.length);
      nx = Math.cos(angle) * NEIGHBOR_MIN_RADIUS;
      nz = Math.sin(angle) * NEIGHBOR_MIN_RADIUS;
    } else {
      const clamped = Math.min(NEIGHBOR_MAX_RADIUS, Math.max(NEIGHBOR_MIN_RADIUS, len));
      nx = (nx / len) * clamped;
      nz = (nz / len) * clamped;
    }
    positions.set(neighbor.id, { x: nx, z: nz });
    world.distantLabels.push(
      makeDistantKingdom(root, nx, nz, relationTint(neighbor.relation), neighbor.name),
    );
  }

  for (const edge of realm.edges) {
    const from = positions.get(edge.fromKingdomId);
    const to = positions.get(edge.toKingdomId);
    if (!from || !to) continue; // görüş alanı dışındaki krallıkların hattı çizilmez
    world.networkLines.push(makeNetworkLine(root, from.x, from.z, to.x, to.z, edgeColor(edge.kind)));
    if (edge.kind === 'trade') {
      world.carts.push(makeTradeCart(root, from.x, from.z, to.x, to.z));
    }
  }

  for (const contested of realm.contestedTiles) {
    const [cx, cz] = tileToWorld(contested.x, contested.y, realm.self.x, realm.self.y);
    world.distantLabels.push(makeContestedMarker(root, cx, cz, contested.label));
  }

  // --- Arazi özellikleri (gerçek tile verisinden) -------------------------
  buildTerrainFeatures(world, realm);

  return world;
}

/**
 * Harita tile'larından coğrafi öğeleri üretir. Başkentin çevresindeki birkaç
 * tile atlanır (kentin kendi düzeni orada), geri kalanlar arazi tipine göre
 * dağ/orman/nehir/kum lekesine dönüşür. Toplam nesne sayısı sınırlanır.
 */
function buildTerrainFeatures(world: BuiltWorld, realm: RealmViewDto): void {
  const centroids = new Map<TerrainType, { x: number; z: number; n: number }>();
  let drawn = 0;

  for (const tile of realm.tiles) {
    const dx = tile.x - realm.self.x;
    const dy = tile.y - realm.self.y;
    if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) continue; // başkent çevresi
    if (drawn >= MAX_TERRAIN_TILES) break;

    const [x, z] = tileToWorld(tile.x, tile.y, realm.self.x, realm.self.y);
    switch (tile.terrain) {
      case 'mountain': {
        // Yükseklik tile koordinatından türetiliyor: aynı harita her yüklemede
        // aynı silueti versin diye rastgelelik yok.
        const height = 4.5 + (Math.abs(dx * 7 + dy * 3) % 4);
        makeMountainRange(world.root, [[x, z, height, 3.2, PALETTE.STONE] as const]);
        drawn++;
        break;
      }
      case 'forest':
        makeForestPatch(world.root, [
          [x, z],
          [x + 2.4, z + 1.8],
          [x - 2.2, z + 2.4],
        ]);
        drawn++;
        break;
      case 'riverbank':
        makeRiver(world.root, x, z, 5, TILE_WORLD + 1);
        drawn++;
        break;
      case 'barren':
        makeAridTile(world.root, x, z);
        drawn++;
        break;
      case 'pass':
        makeMountainRange(world.root, [
          [x - 3, z, 4.5, 2.2, PALETTE.STONE_DARK] as const,
          [x + 3, z, 4.5, 2.2, PALETTE.STONE_DARK] as const,
        ]);
        drawn++;
        break;
      default:
        break;
    }

    const acc = centroids.get(tile.terrain) ?? { x: 0, z: 0, n: 0 };
    acc.x += x;
    acc.z += z;
    acc.n += 1;
    centroids.set(tile.terrain, acc);
  }

  for (const [terrain, acc] of centroids) {
    const label = TERRAIN_FEATURE_LABEL[terrain];
    if (!label || acc.n < 2) continue;
    world.geoLabels.push({
      worldPos: new THREE.Vector3(acc.x / acc.n, 3, acc.z / acc.n),
      text: label,
    });
  }
}

function makeAridTile(parent: THREE.Object3D, x: number, z: number): void {
  makeAridPlain(parent, x, z, TILE_WORLD * 0.55, [
    [x + 1.4, z - 1.1],
    [x - 1.8, z + 1.6],
  ]);
}

// ------------------------------------------------------------------ Demo dünya

/**
 * Giriş yapılmadan önce gösterilen, referans mockup'takiyle aynı Demirkale
 * yerleşimi. Aynı builder'ları kullanır; yalnızca sayılar sabittir.
 */
function buildDemoWorld(world: BuiltWorld): void {
  const root = world.root;
  const detail = world.detailGroup;

  makeRiver(root, -13, 0, 5, 40);
  makeDock(root, -13, -2);

  buildKeep(root, 3);
  buildWalls(root, 2, true);

  const corners: readonly (readonly [number, number])[] = [
    [-4.5, -4.5],
    [4.5, -4.5],
    [-4.5, 4.5],
    [4.5, 4.5],
  ];
  for (const [cx, cz] of corners) {
    addCylinder(root, 0.9, 0.9, 3.2, 10, PALETTE.STONE, cx, 1.6, cz);
    addCone(root, 1.1, 1.4, 10, PALETTE.ROOF_WINE, cx, 3.9, cz);
  }

  addBuilding(root, -9, -7, 3.2, 2.2, 1.8, 1.6, PALETTE.WOOD, PALETTE.ROOF_WINE);
  addBuilding(root, -9, -3.5, 2.6, 2.2, 1.6, 1.4, PALETTE.WOOD, PALETTE.ROOF_BLUE);
  addBuilding(root, 9, -8, 3, 2.4, 1.8, 1.6, PALETTE.WOOD, PALETTE.ROOF_WINE, Math.PI / 8);
  addBuilding(root, 9, 8, 2.4, 2.4, 1.6, 1.4, PALETTE.WOOD, PALETTE.ROOF_BLUE);

  makeChapel(root, 6, -1);
  makeFoundry(root, -6, -7);
  makeMarket(root, 0, 13);
  makeGranary(root, 6, 9);
  makeArcheryRange(root, 13, -3);
  makeStable(root, -9, 1);
  makeTownSquare(root, 3, 6);
  makeWatchtower(root, 0, -10, 2);
  world.blades.push(makeMill(root, 10, 2));

  for (const [fx, fz] of [
    [-8, 7],
    [-5, 9],
    [-9, 10],
  ] as const) {
    makeFarmPlot(detail, fx, fz);
  }

  makeForestPatch(
    detail,
    [
      [-14, -11],
      [-12, -8],
      [-14, -6],
      [12, -13],
      [13, 11],
      [12, 12],
      [-13, 12],
      [-14, 8],
      [14, -2],
      [14, 2],
      [-6, -11],
      [3, -11],
    ],
    1.1,
  );

  makeFigure(root, -1.5, 5.3, PALETTE.ROOF_BLUE, true, Math.PI);
  makeFigure(root, 1.5, 5.3, PALETTE.ROOF_BLUE, true, Math.PI);
  world.torchPositions.push(new THREE.Vector3(-1.6, 1.8, 4.6), new THREE.Vector3(1.6, 1.8, 4.6));

  for (const [vx, vz, color, phase, speed] of [
    [2, 12, PALETTE.WOOD, 0, 0.5],
    [-7, 7.5, 0x9a7a45, 2, 0.4],
    [6.6, -1.6, 0x6b5b3a, 4, 0.6],
  ] as const) {
    const mesh = makeFigure(detail, vx, vz, color, false, 0);
    world.villagers.push({ mesh, baseX: vx, baseZ: vz, phase, speed });
  }

  // Uzak krallıklar — referanstaki konumlar ve tonlar.
  const demoKingdoms: readonly (readonly [string, number, number, number])[] = [
    ['Kızılorman Loncası', -38, -24, PALETTE.TEAL],
    ['Karataş Krallığı', 46, -5, PALETTE.ROOF_WINE],
    ['Ejderbaşı Krallığı', -42, 26, PALETTE.ROOF_WINE],
    ['Yeşilvadi', -58, -8, PALETTE.TEAL],
    ['Gümüşkanat', -20, 48, PALETTE.TEAL],
    ['Akbeyaz Prensliği', 10, 55, PALETTE.TEAL],
    ['Kurtboğan', 68, -12, PALETTE.ROOF_WINE],
    ['Taşyürek', -8, -52, PALETTE.ROOF_WINE],
  ];
  const pos = new Map<string, { x: number; z: number }>([['Demirkale', { x: 0, z: 0 }]]);
  for (const [name, x, z, tint] of demoKingdoms) {
    world.distantLabels.push(makeDistantKingdom(root, x, z, tint, name));
    pos.set(name, { x, z });
  }

  world.distantLabels.push(makeContestedMarker(root, 26, -8, 'Çekişmeli Bölge'));
  const yv = pos.get('Yeşilvadi');
  const ty = pos.get('Taşyürek');
  if (yv && ty) {
    world.distantLabels.push(
      makeContestedMarker(root, (yv.x + ty.x) / 2, (yv.z + ty.z) / 2, 'Uzak Cephe'),
    );
  }

  const link = (a: string, b: string, hostile: boolean) => {
    const pa = pos.get(a);
    const pb = pos.get(b);
    if (!pa || !pb) return;
    world.networkLines.push(
      makeNetworkLine(root, pa.x, pa.z, pb.x, pb.z, hostile ? PALETTE.WINE_LIGHT : PALETTE.BRASS_LIGHT),
    );
    if (!hostile) world.carts.push(makeTradeCart(root, pa.x, pa.z, pb.x, pb.z));
  };
  link('Demirkale', 'Kızılorman Loncası', false);
  link('Demirkale', 'Akbeyaz Prensliği', false);
  link('Kızılorman Loncası', 'Yeşilvadi', false);
  link('Kızılorman Loncası', 'Gümüşkanat', false);
  link('Demirkale', 'Karataş Krallığı', true);
  link('Demirkale', 'Ejderbaşı Krallığı', true);
  link('Yeşilvadi', 'Taşyürek', true);

  // Coğrafya
  makeMountainRange(root, [
    [32, 18, 5, 3.2, PALETTE.STONE] as const,
    [36, 13, 7.5, 3.8, PALETTE.STONE_DARK] as const,
    [40, 20, 4.5, 2.8, 0x5a5650] as const,
    [35, 24, 6.2, 3.4, PALETTE.STONE_DARK] as const,
    [44, 15, 5.5, 3.0, PALETTE.STONE] as const,
    [38, 28, 4, 2.6, 0x5a5650] as const,
  ]);
  world.geoLabels.push({ worldPos: new THREE.Vector3(37, 9, 20), text: 'Dağ Silsilesi' });

  makeRiver(root, -27, -30, 5, 42);
  makeRiver(root, -21, 3, 5, 34);
  world.geoLabels.push({ worldPos: new THREE.Vector3(-24, 3, -15), text: 'Büyük Nehir' });

  makeForestPatch(root, [
    [-36, 6],
    [-33, 4],
    [-30, 7],
    [-37, 10],
    [-34, 9],
    [-31, 11],
    [-38, 13],
    [-35, 14],
    [-32, 15],
    [-29, 12],
    [-36, 17],
    [-33, 18],
    [-30, 16],
    [-38, 8],
    [-28, 9],
  ]);
  world.geoLabels.push({ worldPos: new THREE.Vector3(-33, 3, 11), text: 'Yeşil Orman' });

  makeAridTile(root, 42, 26);
  world.geoLabels.push({ worldPos: new THREE.Vector3(42, 3, 26), text: 'Kıraç Ova' });

  world.levelBadges.push(
    { worldPos: new THREE.Vector3(0, 9.2, 0), text: 'Kale Sv.3→4' },
    { worldPos: new THREE.Vector3(0, 4.3, -4.5), text: 'Sur Sv.2' },
    { worldPos: new THREE.Vector3(4.5, 4.4, -4.5), text: 'Kule Sv.2' },
    { worldPos: new THREE.Vector3(6, 4.4, 9), text: 'Ambar Sv.3' },
  );
}
