/**
 * Sahne yapı taşları — referanstaki vanilla Three.js kodundan taşındı.
 *
 * Tek yapısal değişiklik: referansta her fonksiyon modül düzeyindeki `scene`
 * değişkenine ekleme yapıyordu. Burada hepsi ilk argüman olarak bir
 * `THREE.Object3D` ebeveyni alır. Nedeni React: sahne her mount'ta yeniden
 * kurulur, bu yüzden "içinde bulunulan sahne" örtük bir modül durumu olamaz —
 * ayrıca detay/ağ grupları gibi alt ağaçlara doğrudan ekleme yapabilmemizi
 * sağlar.
 *
 * r128 → modern three farkları (bu dosyayı ilgilendirenler):
 *  - `THREE` global script yerine ESM `import * as THREE from 'three'`.
 *  - r152'den beri renk yönetimi varsayılan olarak açık; hex renkler sRGB kabul
 *    edilip çalışma uzayına dönüştürülüyor. Palet değerleri referanstakiyle
 *    aynı bırakıldı, sonuç birkaç ton daha doygun görünür — kasıtlı.
 *  - `Geometry` sınıfı yok; zaten yalnızca BufferGeometry türevleri kullanılıyor.
 *  - Işık yoğunlukları renderer tarafında ölçekleniyor; nokta ışıkları
 *    (meşaleler) KingdomScene içinde daha yüksek yoğunlukla kuruluyor.
 */

import * as THREE from 'three';

export const PALETTE = {
  STONE: 0x8a8377,
  STONE_DARK: 0x6b6459,
  STONE_LIGHT: 0x9a9484,
  SLATE: 0x4a4a4a,
  ROOF_WINE: 0x7a2426,
  ROOF_BLUE: 0x33506b,
  ROOF_GOLD: 0xb8843a,
  WOOD: 0x8a6f4d,
  WOOD_DARK: 0x5a4530,
  HAY: 0xd9b44a,
  GRASS: 0x5c7a3a,
  WATER: 0x3a6b8a,
  SAND: 0xc9a66b,
  TREE_TRUNK: 0x6b4b2b,
  TREE_LEAF: 0x3f5a2f,
  TEAL: 0x3f7a6b,
  BRASS_LIGHT: 0xdba956,
  WINE_LIGHT: 0x9a3a3c,
} as const;

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

// ---------------------------------------------------------------- İlkel gövdeler

export function addBox(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  color: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

export function addCylinder(
  parent: THREE.Object3D,
  rT: number,
  rB: number,
  h: number,
  seg: number,
  color: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rT, rB, h, seg || 12), lambert(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

export function addCone(
  parent: THREE.Object3D,
  r: number,
  h: number,
  seg: number,
  color: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg || 4), lambert(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export function addPlane(
  parent: THREE.Object3D,
  w: number,
  d: number,
  color: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lambert(color));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** Gövde + dört yüzlü çatı: köydeki her sıradan yapı bundan türer. */
export function addBuilding(
  parent: THREE.Object3D,
  x: number,
  z: number,
  w: number,
  d: number,
  h: number,
  roofH: number,
  bodyColor: number,
  roofColor: number,
  rotY?: number,
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  if (rotY) g.rotation.y = rotY;

  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(bodyColor));
  body.position.y = h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.75, roofH, 4), lambert(roofColor));
  roof.position.y = h + roofH / 2;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  g.add(roof);

  parent.add(g);
  return g;
}

export function makeFigure(
  parent: THREE.Object3D,
  x: number,
  z: number,
  tunicColor: number,
  withSpear: boolean,
  rotY?: number,
): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  if (rotY) g.rotation.y = rotY;

  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.4, 0.2), lambert(0x4a4038));
  legs.position.y = 0.2;
  legs.castShadow = true;
  legs.receiveShadow = true;
  g.add(legs);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.6, 0.22), lambert(tunicColor));
  torso.position.y = 0.7;
  torso.castShadow = true;
  torso.receiveShadow = true;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), lambert(0xd8a878));
  head.position.y = 1.16;
  head.castShadow = true;
  g.add(head);

  if (withSpear) {
    const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), lambert(PALETTE.WOOD_DARK));
    spear.position.set(0.26, 1.0, 0);
    spear.castShadow = true;
    g.add(spear);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 6), lambert(0x9a9a9a));
    tip.position.set(0.26, 1.9, 0);
    tip.castShadow = true;
    g.add(tip);
  }

  parent.add(g);
  return g;
}

/** Sur üstündeki mazgal dişleri. `axis`, duvarın uzandığı eksendir. */
export function crenellate(
  parent: THREE.Object3D,
  cx: number,
  cz: number,
  length: number,
  axis: 'x' | 'z',
  top = 2.8,
): void {
  const n = Math.floor(length);
  const start = -length / 2 + 0.5;
  for (let i = 0; i < n; i += 2) {
    const pos = start + i;
    if (axis === 'z') addBox(parent, 0.5, 0.4, 0.5, PALETTE.STONE_DARK, cx, top, cz + pos);
    else addBox(parent, 0.5, 0.4, 0.5, PALETTE.STONE_DARK, cx + pos, top, cz);
  }
}

// ------------------------------------------------------------- Uzak krallıklar

export interface LabelAnchor {
  worldPos: THREE.Vector3;
  text: string;
}

/**
 * Uzaklaştırıldığında görünen komşu krallık: renk tonu ilişkiyi (savaş/ittifak)
 * taşır. Etiket DOM'u burada oluşturulmaz — yalnızca çapa döndürülür, DOM'u
 * React tarafı yönetir (unmount'ta düğüm sızdırmamak için).
 */
export function makeDistantKingdom(
  parent: THREE.Object3D,
  x: number,
  z: number,
  tintColor: number,
  label: string,
): LabelAnchor {
  const patch = new THREE.Mesh(
    new THREE.CircleGeometry(16, 28),
    new THREE.MeshLambertMaterial({ color: tintColor, transparent: true, opacity: 0.36 }),
  );
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(x, 0.03, z);
  parent.add(patch);

  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.4, 12), lambert(PALETTE.STONE));
  body.position.set(x, 1.2, z);
  body.castShadow = true;
  body.receiveShadow = true;
  parent.add(body);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.4, 12), lambert(tintColor));
  roof.position.set(x, 2.4 + 0.7, z);
  roof.castShadow = true;
  parent.add(roof);

  const huts: [number, number][] = [
    [-2.6, -1.8],
    [2.4, -2.2],
    [0.4, 2.6],
  ];
  for (const [ox, oz] of huts) {
    const hb = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1, 1.1), lambert(PALETTE.WOOD));
    hb.position.set(x + ox, 0.5, z + oz);
    hb.castShadow = true;
    hb.receiveShadow = true;
    parent.add(hb);
    const hr = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.7, 4), lambert(tintColor));
    hr.position.set(x + ox, 1.35, z + oz);
    hr.rotation.y = Math.PI / 4;
    hr.castShadow = true;
    parent.add(hr);
  }

  return { worldPos: new THREE.Vector3(x, 3.4, z), text: label };
}

export function makeContestedMarker(
  parent: THREE.Object3D,
  x: number,
  z: number,
  label: string,
): LabelAnchor {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3, 3.6, 24),
    new THREE.MeshBasicMaterial({
      color: PALETTE.BRASS_LIGHT,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.05, z);
  parent.add(ring);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), lambert(PALETTE.WOOD_DARK));
  pole.position.set(x, 1.2, z);
  pole.castShadow = true;
  parent.add(pole);

  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 0.6),
    new THREE.MeshLambertMaterial({ color: PALETTE.ROOF_WINE, side: THREE.DoubleSide }),
  );
  flag.position.set(x + 0.52, 2.1, z);
  parent.add(flag);

  return { worldPos: new THREE.Vector3(x, 3, z), text: label };
}

// ------------------------------------------------------------------- İlişki ağı

export function makeNetworkLine(
  parent: THREE.Object3D,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  color: number,
): THREE.Line {
  const points = [new THREE.Vector3(x1, 0.08, z1), new THREE.Vector3(x2, 0.08, z2)];
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineDashedMaterial({
    color,
    dashSize: 1.6,
    gapSize: 1.0,
    transparent: true,
    opacity: 0.7,
  });
  const line = new THREE.Line(geo, mat);
  // Kesik çizgi ancak mesafeler hesaplanınca görünür (LineDashedMaterial şartı).
  line.computeLineDistances();
  parent.add(line);
  return line;
}

export interface TradeCart {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  mesh: THREE.Group;
  speed: number;
  phase: number;
}

export function makeTradeCart(
  parent: THREE.Object3D,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): TradeCart {
  const cart = new THREE.Group();

  const bed = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 1.4), lambert(PALETTE.BRASS_LIGHT));
  bed.position.y = 0.45;
  bed.castShadow = true;
  cart.add(bed);

  const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.6, 4), lambert(0xe9dbb8));
  canopy.position.y = 1.0;
  canopy.rotation.y = Math.PI / 4;
  canopy.castShadow = true;
  cart.add(canopy);

  const wheels: [number, number][] = [
    [-0.4, -0.55],
    [0.4, -0.55],
    [-0.4, 0.55],
    [0.4, 0.55],
  ];
  for (const [ox, oz] of wheels) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 8), lambert(0x2e2b28));
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(ox, 0.2, oz);
    cart.add(wheel);
  }

  parent.add(cart);
  return { x1, z1, x2, z2, mesh: cart, speed: 0.12 + Math.random() * 0.05, phase: Math.random() * 8 };
}

// -------------------------------------------------------------- Coğrafi öğeler

/** Dağ silsilesi: `[x, z, yükseklik, taban yarıçapı, renk]` dizisi. */
export function makeMountainRange(
  parent: THREE.Object3D,
  peaks: readonly (readonly [number, number, number, number, number])[],
): void {
  for (const [x, z, h, r, color] of peaks) {
    addCone(parent, r, h, 7, color, x, h / 2, z);
  }
}

export function makeRiver(
  parent: THREE.Object3D,
  x: number,
  z: number,
  width: number,
  length: number,
  rotY = 0,
): THREE.Mesh {
  const mesh = addPlane(parent, width, length, PALETTE.WATER, x, 0.02, z);
  if (rotY) mesh.rotation.z = rotY; // düzlem zaten -90° döndürüldü; akış yönü Z ekseninde
  return mesh;
}

export function makeForestPatch(
  parent: THREE.Object3D,
  spots: readonly (readonly [number, number])[],
  scale = 1,
): void {
  for (const [x, z] of spots) {
    addCylinder(parent, 0.16 * scale, 0.2 * scale, 0.85 * scale, 6, PALETTE.TREE_TRUNK, x, 0.42 * scale, z);
    addCone(parent, 0.8 * scale, 1.4 * scale, 7, PALETTE.TREE_LEAF, x, 1.35 * scale, z);
  }
}

export function makeAridPlain(
  parent: THREE.Object3D,
  x: number,
  z: number,
  radius: number,
  dunes: readonly (readonly [number, number])[] = [],
): void {
  const patch = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), lambert(PALETTE.SAND));
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(x, 0.025, z);
  patch.receiveShadow = true;
  parent.add(patch);
  for (const [dx, dz] of dunes) {
    addCone(parent, 0.6, 0.5, 6, 0x8a7550, dx, 0.25, dz);
  }
}

// ------------------------------------------------------------- Krallık yapıları

/** Değirmen: dönen kanatları animasyon döngüsüne verilmek üzere döndürür. */
export function makeMill(parent: THREE.Object3D, x: number, z: number): THREE.Group {
  const mill = new THREE.Group();
  mill.position.set(x, 0, z);

  const body = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.3, 3, 10), lambert(0xcbb890));
  body.position.y = 1.5;
  body.castShadow = true;
  body.receiveShadow = true;
  mill.add(body);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.3, 10), lambert(PALETTE.ROOF_WINE));
  roof.position.y = 3.6;
  roof.castShadow = true;
  mill.add(roof);

  const blades = new THREE.Group();
  blades.position.set(0, 2.6, 1.1);
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.2, 0.05), lambert(0xe9dbb8));
    blade.position.y = 1.1;
    const pivot = new THREE.Group();
    pivot.rotation.z = (i * Math.PI) / 2;
    pivot.add(blade);
    blades.add(pivot);
  }
  mill.add(blades);

  parent.add(mill);
  return blades;
}

/** Ambar: silindir gövde + konik çatı + ahşap taban. */
export function makeGranary(parent: THREE.Object3D, x: number, z: number): void {
  addCylinder(parent, 1.1, 1.3, 3.2, 12, PALETTE.STONE_LIGHT, x, 1.6, z);
  addCone(parent, 1.3, 1.1, 12, PALETTE.ROOF_WINE, x, 3.75, z);
  addCylinder(parent, 1.15, 1.15, 0.15, 12, PALETTE.WOOD_DARK, x, 0.1, z);
}

/** Okçu meydanı: iki hedef tahtası. */
export function makeArcheryRange(parent: THREE.Object3D, x: number, z: number): void {
  const targets: [number, number][] = [
    [x, z],
    [x + 0.6, z - 1.6],
  ];
  for (const [tx, tz] of targets) {
    addCylinder(parent, 0.04, 0.04, 1.3, 6, PALETTE.WOOD_DARK, tx, 0.65, tz);
    const tgt = addCylinder(parent, 0.55, 0.55, 0.12, 16, PALETTE.HAY, tx, 1.35, tz);
    tgt.rotation.x = Math.PI / 2;
  }
}

/** Ahır + padok çiti. */
export function makeStable(parent: THREE.Object3D, x: number, z: number): void {
  addBuilding(parent, x, z, 2.6, 2, 1.5, 1.3, PALETTE.WOOD, PALETTE.ROOF_BLUE);
  const segments: [number, number, number, number][] = [
    [x - 2.2, z - 2.2, x + 2.2, z - 2.2],
    [x + 2.2, z - 2.2, x + 2.2, z + 2.2],
    [x + 2.2, z + 2.2, x - 2.2, z + 2.2],
    [x - 2.2, z + 2.2, x - 2.2, z - 2.2],
  ];
  for (const [x1, z1, x2, z2] of segments) {
    const mx = (x1 + x2) / 2;
    const mz = (z1 + z2) / 2;
    const len = Math.max(Math.abs(x2 - x1), Math.abs(z2 - z1));
    const horiz = Math.abs(x2 - x1) > Math.abs(z2 - z1);
    addBox(parent, horiz ? len : 0.12, 0.5, horiz ? 0.12 : len, PALETTE.WOOD_DARK, mx, 0.4, mz);
  }
}

/** Meydan: taş zemin, çeşme ve bayrak direği. */
export function makeTownSquare(parent: THREE.Object3D, x: number, z: number): void {
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(2.6, 20), lambert(0xb8a173));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(x, 0.02, z);
  plaza.receiveShadow = true;
  parent.add(plaza);

  addCylinder(parent, 0.6, 0.7, 0.4, 16, PALETTE.STONE_LIGHT, x, 0.2, z);
  addCylinder(parent, 0.08, 0.08, 1.0, 8, PALETTE.STONE_LIGHT, x, 0.9, z);
  addCylinder(parent, 0.04, 0.04, 1.6, 6, PALETTE.WOOD_DARK, x, 1.6, z);

  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 0.45),
    new THREE.MeshLambertMaterial({ color: PALETTE.ROOF_WINE, side: THREE.DoubleSide }),
  );
  flag.position.set(x + 0.38, 2.15, z);
  parent.add(flag);
}

/** Kilise: taş gövde, çan kulesi ve sivri külah. */
export function makeChapel(parent: THREE.Object3D, x: number, z: number): void {
  addBuilding(parent, x, z, 2.4, 1.7, 2.2, 1.9, PALETTE.STONE_LIGHT, PALETTE.SLATE);
  addCylinder(parent, 0.13, 0.13, 1.1, 8, PALETTE.STONE_LIGHT, x, 4.5, z);
  addCone(parent, 0.28, 0.5, 4, PALETTE.SLATE, x, 5.3, z);
}

/** Dökümhane/silahhane: bacadan tüten koyu gövde. */
export function makeFoundry(parent: THREE.Object3D, x: number, z: number): void {
  addBuilding(parent, x, z, 2.8, 2, 1.7, 1.4, PALETTE.WOOD_DARK, PALETTE.SLATE);
  addCylinder(parent, 0.16, 0.16, 1.6, 8, 0x2e2b28, x - 0.9, 2.6, z + 0.4);
}

/** Taş ocağı / maden: kazı çukuru ve moloz yığını. */
export function makeQuarryPit(parent: THREE.Object3D, x: number, z: number, color: number): void {
  const pit = new THREE.Mesh(new THREE.CircleGeometry(1.8, 16), lambert(color));
  pit.rotation.x = -Math.PI / 2;
  pit.position.set(x, 0.02, z);
  pit.receiveShadow = true;
  parent.add(pit);
  addCone(parent, 0.5, 0.7, 6, PALETTE.STONE_DARK, x + 1.1, 0.35, z + 0.8);
  addCone(parent, 0.4, 0.5, 6, PALETTE.STONE, x - 1.0, 0.25, z - 0.7);
}

/** Tarla: sürülmüş toprak + saman yığınları. Yakın plan detayı olduğu için
 * genelde `detailGroup` ebeveyniyle çağrılır. */
export function makeFarmPlot(parent: THREE.Object3D, x: number, z: number): void {
  const plot = new THREE.Mesh(new THREE.PlaneGeometry(4, 3.2), lambert(0x9a7a45));
  plot.rotation.x = -Math.PI / 2;
  plot.position.set(x, 0.02, z);
  plot.receiveShadow = true;
  parent.add(plot);
  for (let j = 0; j < 3; j++) {
    addCone(parent, 0.35, 0.6, 6, PALETTE.HAY, x - 1 + j, 0.3, z + (j % 2 ? 0.4 : -0.4));
  }
}

/** Pazar: tenteli tezgâhlar ve sandıklar. */
export function makeMarket(parent: THREE.Object3D, x: number, z: number): void {
  addBuilding(parent, x + 2, z, 1.4, 1.1, 1, 0.8, PALETTE.WOOD, PALETTE.ROOF_GOLD);
  addBuilding(parent, x - 2, z, 1.4, 1.1, 1, 0.8, PALETTE.WOOD, 0x4a6b3f);
  addBox(parent, 0.4, 0.4, 0.4, PALETTE.WOOD_DARK, x + 2.9, 0.2, z + 0.6);
  addBox(parent, 0.4, 0.4, 0.4, PALETTE.WOOD_DARK, x - 2.9, 0.2, z - 0.6);
}

/** İskele ve kayık — nehir kenarı başkentlerde. */
export function makeDock(parent: THREE.Object3D, x: number, z: number): void {
  addBox(parent, 3.2, 0.15, 1.3, PALETTE.WOOD, x, 0.2, z);
  for (const px of [x - 1.5, x, x + 1.5]) {
    addCylinder(parent, 0.08, 0.08, 0.6, 6, PALETTE.WOOD_DARK, px, 0.05, z);
  }
  const boat = addBox(parent, 1.6, 0.3, 0.6, 0x6b4b2b, x - 1.2, 0.18, z - 1.2);
  boat.rotation.y = 0.3;
}

/** Nöbet kulesi (bağımsız, sur köşesi dışında). */
export function makeWatchtower(parent: THREE.Object3D, x: number, z: number, level: number): void {
  const h = 3 + level * 0.5;
  addBox(parent, 1.4, 0.5, 1.4, PALETTE.STONE_DARK, x, 0.25, z);
  addCylinder(parent, 0.7, 0.8, h, 10, PALETTE.STONE, x, h / 2 + 0.5, z);
  addCone(parent, 0.95, 1.3, 10, PALETTE.ROOF_WINE, x, h + 1.15, z);
}

// ------------------------------------------------------------------- Temizlik

/**
 * Ağacın tamamındaki geometri ve materyalleri serbest bırakır.
 *
 * WebGL kaynakları GC'ye tabi değil; React'te sahne her mount'ta yeniden
 * kurulduğu için bunu atlamak birkaç sayfa geçişinde bağlam kaybına kadar gider.
 */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as Partial<THREE.Mesh> & THREE.Object3D;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else if (material) material.dispose();
  });
  root.clear();
}
