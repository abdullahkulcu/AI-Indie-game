/**
 * Krallığın izometrik 3B görünümü.
 *
 * Referanstaki vanilla döngünün React karşılığı. Üç ayrı efekt var:
 *  1. Motor (renderer/kamera/ışık/RAF) — mount'ta bir kez kurulur.
 *  2. Dünya (mesh ağacı) — yalnızca yapısal veri değişince yeniden kurulur;
 *     10 saniyelik yoklamanın her turunda sahneyi baştan inşa etmek hem pahalı
 *     hem de görsel olarak sarsıcı olurdu.
 *  3. Gündüz/gece hedefi.
 *
 * r128 → modern three farkları:
 *  - ESM import; global `THREE` yok.
 *  - r155'ten beri ışıklandırma fiziksel birimlerde: nokta ışıklarının şiddeti
 *    mesafenin karesiyle söner, bu yüzden meşalelerin gece yoğunluğu referanstaki
 *    0.9 yerine belirgin biçimde yüksek (aşağıdaki TORCH_NIGHT).
 *  - `outputColorSpace`/ColorManagement varsayılan açık.
 *  - `renderer.setSize(w, h, false)`: tuval boyutunu CSS yönetiyor, satır içi
 *    stil yazmasını istemiyoruz (ResizeObserver ile geri besleme döngüsü olmasın).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import * as THREE from 'three';
import type { KingdomStateDto, RealmViewDto } from '@krallik/shared';
import { disposeObject } from './builders';
import { buildWorld } from './layout';
import type { BuiltWorld } from './layout';

const VIEW_SIZE = 15;
const PHI = THREE.MathUtils.degToRad(35.264); // gerçek izometrik açı
const START_THETA = Math.PI / 4;
const RADIUS = 30;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 2.2;
const AUTO_ROTATE_RESUME_MS = 3000;
/** Fiziksel ışık birimlerinde meşalenin gece şiddeti (bkz. dosya başı notu). */
const TORCH_NIGHT = 18;
const TORCH_DAY = 0.5;

const STAR_POSITIONS: readonly (readonly [number, number])[] = [
  [8, 10],
  [18, 6],
  [30, 14],
  [42, 5],
  [55, 9],
  [65, 4],
  [74, 12],
  [85, 7],
  [15, 22],
  [38, 20],
  [60, 24],
  [80, 20],
  [25, 3],
  [48, 28],
];

interface LabelNode {
  el: HTMLDivElement;
  worldPos: THREE.Vector3;
  kind: 'distant' | 'geo' | 'badge';
}

interface Engine {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  ambient: THREE.AmbientLight;
  sun: THREE.DirectionalLight;
  torches: THREE.PointLight[];
  world: BuiltWorld | null;
  labels: LabelNode[];
  theta: number;
  autoRotate: boolean;
  lightMix: number;
  lightMixTarget: number;
}

export interface KingdomSceneProps {
  kingdom: KingdomStateDto | null;
  realm: RealmViewDto | null;
  /** Sahnenin üzerinde yüzen arayüz (sancak, rozetler, kenar çubuğu). */
  children?: ReactNode;
}

/**
 * Dünya ağacını yeniden kurmayı gerektiren veri parmak izi. Kaynak miktarı ya
 * da nüfus değiştiğinde sahne aynı kalır; bina seviyeleri veya komşular
 * değiştiğinde kurulur.
 */
function worldSignature(kingdom: KingdomStateDto | null, realm: RealmViewDto | null): string {
  if (!kingdom || !realm) return 'demo';
  const buildings = kingdom.buildings
    .map((b) => `${b.type}:${b.level}:${b.upgradingToLevel ?? '-'}`)
    .sort()
    .join(',');
  const neighbors = realm.neighbors.map((n) => `${n.id}:${n.relation}:${n.x},${n.y}`).join(',');
  const edges = realm.edges.map((e) => `${e.fromKingdomId}>${e.toKingdomId}:${e.kind}`).join(',');
  const contested = realm.contestedTiles.map((c) => `${c.x},${c.y}`).join(',');
  return [
    kingdom.id,
    kingdom.keepLevel,
    kingdom.capitalTerrain,
    buildings,
    neighbors,
    edges,
    contested,
    realm.tiles.length,
  ].join('|');
}

export function KingdomScene({ kingdom, realm, children }: KingdomSceneProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [isNight, setIsNight] = useState(false);
  const [ready, setReady] = useState(false);

  const signature = useMemo(() => worldSignature(kingdom, realm), [kingdom, realm]);

  // --- 1. Motor -------------------------------------------------------------
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const scene = new THREE.Scene();
    const aspectOf = () => Math.max(wrap.clientWidth, 1) / Math.max(wrap.clientHeight, 1);
    const camera = new THREE.OrthographicCamera(
      -VIEW_SIZE * aspectOf(),
      VIEW_SIZE * aspectOf(),
      VIEW_SIZE,
      -VIEW_SIZE,
      0.1,
      300,
    );

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      // WebGL yoksa sahne yerine "yüklenemedi" metni kalır; uygulama çalışmaya devam eder.
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(wrap.clientWidth, wrap.clientHeight, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const ambient = new THREE.AmbientLight(0xffe8c9, 0.6);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff1d6, 0.9);
    sun.position.set(14, 20, 9);
    sun.castShadow = true;
    sun.shadow.camera.left = -22;
    sun.shadow.camera.right = 22;
    sun.shadow.camera.top = 22;
    sun.shadow.camera.bottom = -22;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);

    const engine: Engine = {
      scene,
      camera,
      renderer,
      ambient,
      sun,
      torches: [],
      world: null,
      labels: [],
      theta: START_THETA,
      autoRotate: true,
      lightMix: 0,
      lightMixTarget: 0,
    };
    engineRef.current = engine;

    const target = new THREE.Vector3(0, 1, 0);
    const updatePosition = () => {
      camera.position.set(
        target.x + RADIUS * Math.cos(PHI) * Math.sin(engine.theta),
        target.y + RADIUS * Math.sin(PHI),
        target.z + RADIUS * Math.cos(PHI) * Math.cos(engine.theta),
      );
      camera.lookAt(target);
    };
    updatePosition();

    // --- Etkileşim ---
    let dragging = false;
    let lastX = 0;
    let idleTimer = 0;
    const pauseAutoRotate = () => {
      engine.autoRotate = false;
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        engine.autoRotate = true;
      }, AUTO_ROTATE_RESUME_MS);
    };

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      pauseAutoRotate();
    };
    const onPointerUp = () => {
      dragging = false;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      engine.theta -= dx * 0.006;
      updatePosition();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      pauseAutoRotate();
      camera.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, camera.zoom - e.deltaY * 0.001));
      camera.updateProjectionMatrix();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    const onResize = () => {
      const a = aspectOf();
      camera.left = -VIEW_SIZE * a;
      camera.right = VIEW_SIZE * a;
      camera.top = VIEW_SIZE;
      camera.bottom = -VIEW_SIZE;
      camera.updateProjectionMatrix();
      renderer.setSize(wrap.clientWidth, wrap.clientHeight, false);
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(wrap);

    // --- Döngü ---
    const clock = new THREE.Clock();
    let elapsed = 0;
    let raf = 0;

    const projected = new THREE.Vector3();
    const projectLabel = (node: LabelNode, visible: boolean) => {
      projected.copy(node.worldPos).project(camera);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      node.el.style.left = `${(projected.x * 0.5 + 0.5) * w}px`;
      node.el.style.top = `${(-projected.y * 0.5 + 0.5) * h}px`;
      node.el.classList.toggle('visible', visible && projected.z < 1);
    };

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.1);
      elapsed += dt;

      const world = engine.world;
      if (world) {
        for (const blades of world.blades) blades.rotation.z += dt * 1.2;
      }
      if (engine.autoRotate) {
        engine.theta += dt * 0.04;
        updatePosition();
      }

      // Gündüz/gece çapraz geçişi.
      engine.lightMix += (engine.lightMixTarget - engine.lightMix) * Math.min(1, dt * 2.2);
      const mix = engine.lightMix;
      ambient.intensity = 0.6 + (0.18 - 0.6) * mix;
      ambient.color.copy(AMBIENT_DAY).lerp(AMBIENT_NIGHT, mix);
      sun.intensity = 0.9 + (0.15 - 0.9) * mix;
      sun.color.copy(SUN_DAY).lerp(SUN_NIGHT, mix);
      for (const torch of engine.torches) {
        torch.intensity = TORCH_DAY + (TORCH_NIGHT - TORCH_DAY) * mix;
      }

      if (world) {
        for (const v of world.villagers) {
          v.mesh.position.x = v.baseX + Math.sin(elapsed * v.speed + v.phase) * 1.1;
          v.mesh.rotation.y = Math.cos(elapsed * v.speed + v.phase) >= 0 ? 0 : Math.PI;
        }

        world.detailGroup.visible = camera.zoom > 0.5;

        const showFar = camera.zoom < 0.78;
        const showBadges = camera.zoom > 0.42;
        for (const line of world.networkLines) line.visible = showFar;
        for (const cart of world.carts) {
          const t = (Math.sin(elapsed * cart.speed + cart.phase) + 1) / 2;
          cart.mesh.position.set(cart.x1 + (cart.x2 - cart.x1) * t, 0.2, cart.z1 + (cart.z2 - cart.z1) * t);
          cart.mesh.rotation.y = Math.atan2(cart.x2 - cart.x1, cart.z2 - cart.z1);
          cart.mesh.visible = showFar;
        }
        for (const node of engine.labels) {
          projectLabel(node, node.kind === 'badge' ? showBadges : showFar);
        }
      }

      renderer.render(scene, camera);
    };
    animate();
    setReady(true);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(idleTimer);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('wheel', onWheel);

      for (const node of engine.labels) node.el.remove();
      engine.labels = [];
      if (engine.world) disposeObject(engine.world.root);
      disposeObject(scene);
      renderer.dispose();
      // Bağlamı hemen bırak: sayfa geçişlerinde tarayıcının WebGL bağlam
      // sınırına (genelde 8-16) takılmamak için.
      renderer.forceContextLoss();
      engineRef.current = null;
    };
  }, []);

  // --- 2. Dünya -------------------------------------------------------------
  useEffect(() => {
    const engine = engineRef.current;
    const labelHost = labelsRef.current;
    if (!engine || !labelHost) return;

    // Önceki dünyayı ve etiketlerini tamamen bırak.
    if (engine.world) {
      engine.scene.remove(engine.world.root);
      disposeObject(engine.world.root);
    }
    for (const node of engine.labels) node.el.remove();
    engine.labels = [];
    for (const torch of engine.torches) engine.scene.remove(torch);
    engine.torches = [];

    const world = buildWorld(kingdom, realm);
    engine.scene.add(world.root);
    engine.world = world;

    for (const pos of world.torchPositions) {
      const torch = new THREE.PointLight(0xffaa55, TORCH_DAY, 10);
      torch.position.copy(pos);
      engine.scene.add(torch);
      engine.torches.push(torch);
    }

    const addLabels = (anchors: { worldPos: THREE.Vector3; text: string }[], kind: LabelNode['kind']) => {
      for (const anchor of anchors) {
        const el = document.createElement('div');
        el.className = 'kdm-label';
        el.textContent = anchor.text;
        labelHost.appendChild(el);
        engine.labels.push({ el, worldPos: anchor.worldPos, kind });
      }
    };
    addLabels(world.distantLabels, 'distant');
    addLabels(world.geoLabels, 'geo');
    addLabels(world.levelBadges, 'badge');

    // Bağımlılık yalnızca `signature`: kingdom/realm nesneleri her yoklamada yeni
    // referans alır ama yapısal içerik değişmedikçe sahneyi yeniden kurmayız.
    // Bu efekt motor efektinden sonra çalıştığı için engineRef doludur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // --- 3. Gece/gündüz -------------------------------------------------------
  useEffect(() => {
    const engine = engineRef.current;
    if (engine) engine.lightMixTarget = isNight ? 1 : 0;
  }, [isNight]);

  return (
    <div className="world-stage" ref={wrapRef}>
      {!ready && <div className="view-loading">sahne yükleniyor…</div>}

      <div className={`night-overlay${isNight ? ' active' : ''}`}>
        {STAR_POSITIONS.map(([left, top]) => (
          <span className="star" key={`${left}-${top}`} style={{ left: `${left}%`, top: `${top}%` }} />
        ))}
      </div>

      <canvas className="kingdom-canvas" ref={canvasRef} />
      <div className="kingdom-labels" ref={labelsRef} />

      <button
        className="time-toggle"
        type="button"
        onClick={() => setIsNight((v) => !v)}
        aria-label="Gündüz/gece görünümünü değiştir"
        aria-pressed={isNight}
      >
        {isNight ? (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        )}
        <span>{isNight ? 'Gece' : 'Gündüz'}</span>
      </button>

      <p className="view-hint-float">
        Sürükleyerek çevirin · Kaydırarak yakınlaştırın/uzaklaştırın — uzaklaştıkça komşu krallıkları,
        aralarındaki ticaret/düşmanlık ağlarını ve çekişmeli bölgeyi görürsünüz.
      </p>

      {children}
    </div>
  );
}

const AMBIENT_DAY = new THREE.Color(0xffe8c9);
const AMBIENT_NIGHT = new THREE.Color(0x33406b);
const SUN_DAY = new THREE.Color(0xfff1d6);
const SUN_NIGHT = new THREE.Color(0x7d93c9);
