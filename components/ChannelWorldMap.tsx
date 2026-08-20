"use client";

import { useState } from "react";
import { BIOMES, biomeFeatures, jitter, worldRiver, worldRoads, type Biome, type FeatureKind } from "@/engine/world-map";

// Raporun içeriği SUNUCUDA kararlaşır (server/world-projection.ts → intelReportOf):
// hükümdar, arazi, kale, nüfus, yapı, ordu. Ambar, nöbet oranı ve maaş VERİLMEZ —
// müzakeredeki blöf oradan doğar.
type IntelReport = { ruler: string; keepLevel: number; population: number; buildingCount: number; army: number };
type WorldKingdom = { id: string; name: string | null; terrain: string; position: { x: number; z: number }; ring?: number; discovered: boolean; mission: { status: "pending" | "succeeded" | "failed" | "detected"; completesAt: number; successChance: number } | null; report: IntelReport | null; reportAt?: number | null; reportStale?: boolean };
type SharedMine = { mine: { name: string; oreRemaining: number; extractedOre: number; totalWorkers: number; position: { x: number; z: number } }; participants: Array<{ id: string; name: string; workers: number; self: boolean }> };
type Selection = { kind: "home" } | { kind: "kingdom"; id: string } | { kind: "mine" };

/**
 * Arazinin öne çıkan üretimi. Kaynağı engine/catalog.ts içindeki gerçek arazi
 * çarpanlarıdır (orman +%25 odun, dağ +%30 taş/demir, nehir kıyısı +%25
 * yiyecek); uydurma bir üretim kolu işaretlenmiyor. Ova dengelidir, rozeti yok.
 */
const produceOf: Record<string, { icon: string; label: string } | undefined> = {
  forest: { icon: "◤", label: "ODUN" },
  mountain: { icon: "⛊", label: "DEMİR" },
  riverbank: { icon: "≋", label: "YİYECEK" },
};
type Point = { x: number; y: number };

const terrainNames: Record<string, string> = { plain: "Ova", forest: "Orman", mountain: "Dağ", riverbank: "Nehir Kıyısı" };

/** Dünya koordinatını harita yüzdesine çevirir. `extent` büyüdükçe görüş alanı açılır. */
const project = (value: number, extent: number) => 50 + (value / Math.max(1, extent)) * 42;
/** Harita uzayı 0-100; yüzdeyle birebir aynı ölçek, işaretçilerle hizalı kalır. */
const polar = (angleDeg: number, radius: number): Point => {
  const angle = angleDeg * Math.PI / 180;
  return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius };
};
const round = (value: number) => Math.round(value * 100) / 100;

/** Köşeleri yuvarlatılmış kapalı eğri; biyom sınırlarını radyal çizgi olmaktan çıkarır. */
function closedCurve(points: Point[]) {
  if (points.length < 3) return "";
  const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const first = mid(points[points.length - 1], points[0]);
  let path = `M${round(first.x)},${round(first.y)}`;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i], next = points[(i + 1) % points.length], end = mid(current, next);
    path += ` Q${round(current.x)},${round(current.y)} ${round(end.x)},${round(end.y)}`;
  }
  return `${path} Z`;
}

/** Açık eğri: yol merkez hattı. */
function openCurve(points: Point[]) {
  if (!points.length) return "";
  let path = `M${round(points[0].x)},${round(points[0].y)}`;
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1], current = points[i];
    path += ` Q${round(previous.x)},${round(previous.y)} ${round((previous.x + current.x) / 2)},${round((previous.y + current.y) / 2)}`;
  }
  const last = points[points.length - 1];
  return `${path} L${round(last.x)},${round(last.y)}`;
}

/**
 * Değişken genişlikte şerit. Nehir sabit kalınlıkta bir bant değil; iki kenarı
 * ayrı hesaplanır, böylece kaynakta daralıp ağza doğru genişler.
 */
function ribbon(points: Array<Point & { w: number }>) {
  if (points.length < 2) return "";
  const left: Point[] = [], right: Point[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const previous = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.x - previous.x, dy = next.y - previous.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length, ny = dx / length, half = points[i].w / 2;
    left.push({ x: points[i].x + nx * half, y: points[i].y + ny * half });
    right.push({ x: points[i].x - nx * half, y: points[i].y - ny * half });
  }
  const forward = left.map(p => `${round(p.x)},${round(p.y)}`).join(" L");
  const back = right.reverse().map(p => `${round(p.x)},${round(p.y)}`).join(" L");
  return `M${forward} L${back} Z`;
}

/** İki doğru parçasının kesişimi; yol nehri geçtiğinde köprü buraya konur. */
function crossing(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const dax = a2.x - a1.x, day = a2.y - a1.y, dbx = b2.x - b1.x, dby = b2.y - b1.y;
  const denominator = dax * dby - day * dbx;
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((b1.x - a1.x) * dby - (b1.y - a1.y) * dbx) / denominator;
  const u = ((b1.x - a1.x) * day - (b1.y - a1.y) * dax) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a1.x + dax * t, y: a1.y + day * t };
}

/** Biyom kuşağı: pasta dilimi değil, kenarları dağınık organik bir leke. */
function biomeBlob(biome: Biome, seed: string) {
  const from = biome.centerAngle - biome.spread / 2 - 11, to = biome.centerAngle + biome.spread / 2 + 11;
  const steps = 16, outer: Point[] = [], inner: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = from + (to - from) * (i / steps);
    outer.push(polar(angle, 48 + jitter(`${seed}:${biome.id}:o${i}`, 17)));
    inner.push(polar(angle, 7 + jitter(`${seed}:${biome.id}:i${i}`, 6)));
  }
  return closedCurve([...outer, ...inner.reverse()]);
}

const FEATURE_SYMBOL: Record<FeatureKind, string> = {
  pine: "wm-pine", broadleaf: "wm-broadleaf", peak: "wm-peak", ridge: "wm-ridge",
  wave: "wm-wave", reed: "wm-reed", wheat: "wm-wheat", grass: "wm-grass",
};

/** Çizilmiş harita sembolleri. Emoji değil; her biyom kendi rengini alır. */
function MapSymbols() {
  return <svg className="map-symbol-defs" aria-hidden="true" focusable="false"><defs>
    <symbol id="wm-pine" viewBox="0 0 24 24">
      <path d="M12 2 L17 11 H14.5 L19 18 H5 L9.5 11 H7 Z" fill="currentColor"/>
      <rect x="11" y="17" width="2" height="5" fill="currentColor"/>
    </symbol>
    <symbol id="wm-broadleaf" viewBox="0 0 24 24">
      <path d="M12 3 a6.5 6 0 0 1 5.5 9.5 a5 5 0 0 1 -11 0 A6.5 6 0 0 1 12 3 Z" fill="currentColor"/>
      <rect x="11" y="15" width="2" height="7" fill="currentColor"/>
    </symbol>
    <symbol id="wm-peak" viewBox="0 0 24 24">
      <path d="M1 21 L9 5 L13.5 13 L16.5 8.5 L23 21 Z" fill="currentColor"/>
      <path d="M9 5 L12 10.5 L6 10.5 Z" fill="#ffffff" opacity=".55"/>
    </symbol>
    <symbol id="wm-ridge" viewBox="0 0 24 24">
      <path d="M1 20 L7 11 L12 18 L16 12.5 L23 20 Z" fill="currentColor"/>
    </symbol>
    <symbol id="wm-wave" viewBox="0 0 24 24">
      <path d="M2 9 q3.5 -4 7 0 t7 0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/>
      <path d="M2 15 q3.5 -4 7 0 t7 0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/>
    </symbol>
    <symbol id="wm-reed" viewBox="0 0 24 24">
      <path d="M7 22 V10 M12 22 V6 M17 22 V12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
      <path d="M12 6 l2.5 3 h-5 Z M7 10 l2 2.5 h-4 Z" fill="currentColor"/>
    </symbol>
    <symbol id="wm-wheat" viewBox="0 0 24 24">
      <path d="M12 22 V8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M12 8 l4 3 l-4 2 Z M12 8 l-4 3 l4 2 Z M12 13 l4 3 l-4 2 Z M12 13 l-4 3 l4 2 Z" fill="currentColor"/>
    </symbol>
    <symbol id="wm-grass" viewBox="0 0 24 24">
      <path d="M5 21 q2 -8 5 -10 M12 21 q0 -9 1 -12 M19 21 q-2 -8 -5 -10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </symbol>
  </defs></svg>;
}

/** Raporun kaç zaman önce alındığı; "bayat" işareti sunucudan gelir. */
function reportAge(at: number) {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (minutes < 60) return `${minutes} dakika`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} saat` : `${Math.round(hours / 24)} gün`;
}

export default function ChannelWorldMap({ channelName, homeName, homeTerrain, homePosition, homeKeepLevel, extent, kingdoms, sharedMine, busy, formatLeft, onClose, onScout, onMine }: {
  channelName: string; homeName: string; homeTerrain: string; kingdoms: WorldKingdom[]; sharedMine: SharedMine | null; busy: boolean;
  homePosition?: { x: number; z: number; ring: number; biome: string }; homeKeepLevel?: number; extent?: number;
  formatLeft: (at: number) => string; onClose: () => void; onScout: (id: string) => void; onMine: (action: "join" | "leave") => void;
}) {
  const [selection, setSelection] = useState<Selection>({ kind: "home" });
  const home = homePosition ?? { x: 0, z: 0, ring: 0, biome: homeTerrain };
  // Görüş alanı en dıştaki krallığa göre açılır; dünya büyüdükçe harita da büyür.
  const span = extent ?? 60;

  const biomeTints: Record<string, string> = {
    plain: "#8c9e58", forest: "#345636", mountain: "#746e62", riverbank: "#4a7484",
  };
  // Nehir ve yollar channel kimliğinden türer; aynı channel her açılışta aynı coğrafya.
  const riverPoints = worldRiver(channelName, span).map(point => ({ x: project(point.x, span), y: project(point.z, span), w: (point.width / Math.max(1, span)) * 42 }));
  const roadLines = worldRoads(channelName, span).map(road => road.map(point => ({ x: project(point.x, span), y: project(point.z, span) })));
  // Yol nehri kestiği yere köprü; yol suyun üstünden köprüsüz geçmez.
  const bridges: Array<Point & { angle: number }> = [];
  for (const road of roadLines) {
    for (let i = 1; i < road.length; i += 1) {
      for (let j = 1; j < riverPoints.length; j += 1) {
        const hit = crossing(road[i - 1], road[i], riverPoints[j - 1], riverPoints[j]);
        if (!hit) continue;
        const angle = Math.atan2(road[i].y - road[i - 1].y, road[i].x - road[i - 1].x) * 180 / Math.PI;
        if (!bridges.some(bridge => Math.hypot(bridge.x - hit.x, bridge.y - hit.y) < 4)) bridges.push({ ...hit, angle });
      }
    }
  }

  const selectedKingdom = selection.kind === "kingdom" ? kingdoms.find(kingdom => kingdom.id === selection.id) ?? null : null;
  const joinedMine = Boolean(sharedMine?.participants.some(participant => participant.self));
  const regionCount = kingdoms.length + 1 + (sharedMine ? 1 : 0);

  return <div className="channel-map-overlay" role="dialog" aria-modal="true" aria-label={`${channelName} channel haritası`}>
    <header className="channel-map-header"><div><span>STRATEJİK DÜNYA GÖRÜNÜMÜ</span><h2>{channelName}</h2><p>{regionCount === 1 ? "Bu channel'da yalnızca sizin bölgeniz görünüyor" : `${regionCount} bölge`} · Krallık isimleri başarılı keşiften sonra açılır</p></div><button onClick={onClose}>BAŞKENTE DÖN ✕</button></header>
    <div className="channel-map-layout">
      <section className="channel-map-canvas">
        <MapSymbols/>
        {/* Çizilmiş harita katmanı: biyom lekeleri, nehir, yollar, köprüler.
            preserveAspectRatio="none" ile 0-100 uzayı yüzdelerle birebir örtüşür,
            böylece işaretçilerle hizalı kalır. */}
        <svg className="map-art" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <defs>
            <filter id="wm-soft" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="1.9"/>
            </filter>
            <filter id="wm-coast" x="-30%" y="-30%" width="160%" height="160%">
              <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="3" seed="7" result="noise"/>
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.4" xChannelSelector="R" yChannelSelector="G"/>
              <feGaussianBlur stdDeviation=".5"/>
            </filter>
          </defs>
          {/* Biyom kuşakları: kenarları bulanık ve düzensiz, üst üste binerek geçişir. */}
          <g filter="url(#wm-soft)" opacity=".82">
            {BIOMES.map(biome => <path key={biome.id} d={biomeBlob(biome, channelName)} fill={biomeTints[biome.id]}/>)}
          </g>
          {/* Mesafe halkaları */}
          <g className="map-art-rings">
            {[1, 2, 3, 4, 5].map(ring => <ellipse key={ring} cx="50" cy="50" rx={ring * 8.5} ry={ring * 8.5} vectorEffect="non-scaling-stroke"/>)}
          </g>
          {/* Nehir: kıyı çizgisi düzensiz, yatak daralıp genişliyor. */}
          <g filter="url(#wm-coast)">
            <path d={ribbon(riverPoints.map(p => ({ ...p, w: p.w * 1.75 })))} fill="#3f6f7a" opacity=".55"/>
            <path d={ribbon(riverPoints)} fill="#2f5c6b"/>
            <path d={ribbon(riverPoints.map(p => ({ ...p, w: p.w * .4 })))} fill="#4d8393" opacity=".7"/>
          </g>
          {/* Yollar: kıvrılan, kesik izli patikalar. */}
          <g className="map-art-roads">
            {roadLines.map((road, index) => <g key={index}>
              <path d={openCurve(road)} className="road-casing" vectorEffect="non-scaling-stroke"/>
              <path d={openCurve(road)} className="road-track" vectorEffect="non-scaling-stroke"/>
            </g>)}
          </g>
        </svg>
        {/* Köprüler ve arazi sembolleri HTML katmanında: sabit piksel boyutlu
            oldukları için haritanın en/boy oranı değişince ezilmezler. */}
        <div className="map-bridges" aria-hidden="true">
          {bridges.map((bridge, index) =>
            <span key={index} style={{ left: `${bridge.x}%`, top: `${bridge.y}%`, transform: `translate(-50%,-50%) rotate(${bridge.angle}deg)` }}>
              <svg viewBox="0 0 24 14"><rect x="2" y="4" width="20" height="6" rx="1"/><path d="M6 4 V10 M10 4 V10 M14 4 V10 M18 4 V10"/></svg>
            </span>)}
        </div>
        <div className="map-features" aria-hidden="true">
          {biomeFeatures(channelName, span).map((feature, index) =>
            <span key={index} className={feature.biome} style={{ left: `${project(feature.x, span)}%`, top: `${project(feature.z, span)}%`, width: `${feature.size}px`, height: `${feature.size}px` }}>
              <svg viewBox="0 0 24 24"><use href={`#${FEATURE_SYMBOL[feature.kind]}`}/></svg>
            </span>)}
        </div>
        {/* Bölge adları işaretçi halkasının DIŞINDA durur; içeride kalınca krallık
            kutuları adın başını örtüyor ve "AORMAN KUŞAĞI" gibi okunuyordu. */}
        <div className="map-biome-labels" aria-hidden="true">
          {BIOMES.map(biome => {
            const spot = polar(biome.centerAngle, 47);
            return <em key={biome.id} className={biome.id} style={{ left: `${spot.x}%`, top: `${spot.y}%` }}>{biome.label}</em>;
          })}
        </div>
        <button className={`map-region home ${selection.kind === "home" ? "selected" : ""} ${homeTerrain}`} style={{ left: `${project(home.x, span)}%`, top: `${project(home.z, span)}%` }} onClick={() => setSelection({ kind: "home" })}><i className={`castle keep-${Math.min(6, homeKeepLevel ?? 1)}`}>♜</i><b>{homeName}</b><small>BAŞKENTİN</small>{produceOf[homeTerrain] && <em className="produce" title={`${terrainNames[homeTerrain] ?? homeTerrain} · ${produceOf[homeTerrain]!.label}`}>{produceOf[homeTerrain]!.icon}<span>{produceOf[homeTerrain]!.label}</span></em>}</button>
        {kingdoms.map((kingdom, index) => <button key={kingdom.id} className={`map-region kingdom ${kingdom.terrain} ${kingdom.discovered ? "discovered" : "unknown"} ${selection.kind === "kingdom" && selection.id === kingdom.id ? "selected" : ""}`} style={{ left: `${project(kingdom.position.x, span)}%`, top: `${project(kingdom.position.z, span)}%`, zIndex: 20 + index }} onClick={() => setSelection({ kind: "kingdom", id: kingdom.id })}><i className={`castle ${kingdom.discovered ? `keep-${Math.min(6, kingdom.report?.keepLevel ?? 1)}` : "unscouted"}`}>♜</i><b>{kingdom.name ?? "Bilinmeyen Sancak"}</b><small>{kingdom.discovered ? `Kale Sv.${kingdom.report?.keepLevel ?? 1}` : terrainNames[kingdom.terrain] ?? "Bölge"}</small>{produceOf[kingdom.terrain] && <em className="produce" title={`${terrainNames[kingdom.terrain] ?? kingdom.terrain} · ${produceOf[kingdom.terrain]!.label}`}>{produceOf[kingdom.terrain]!.icon}<span>{produceOf[kingdom.terrain]!.label}</span></em>}</button>)}
        {sharedMine && <button className={`map-region mine ${selection.kind === "mine" ? "selected" : ""}`} style={{ left: `${project(sharedMine.mine.position.x, span)}%`, top: `${project(sharedMine.mine.position.z, span)}%` }} onClick={() => setSelection({ kind: "mine" })}><i>⛏</i><b>{sharedMine.mine.name}</b><small>{sharedMine.mine.totalWorkers} İŞÇİ</small></button>}
        <div className="map-compass"><b>K</b><span>✦</span><small>G</small></div><div className="channel-map-legend"><span><i className="legend-home"/> Senin krallığın</span><span><i className="legend-unknown"/> Keşfedilmemiş</span><span><i className="legend-mine"/> Ortak saha</span></div>
      </section>
      <aside className="region-inspector">
        {selection.kind === "home" && <><span className="inspector-kicker">MERKEZ BÖLGE</span><div className={`region-portrait ${homeTerrain}`}><i>♜</i></div><h3>{homeName}</h3><p>{terrainNames[homeTerrain] ?? "Başkent"} arazisindeki kendi yönetim merkeziniz.</p><dl><div><dt>Konum</dt><dd>Harita merkezi</dd></div><div><dt>Durum</dt><dd>Yönetiminizde</dd></div><div><dt>Görüş</dt><dd>Tam</dd></div></dl><button className="inspector-action" onClick={onClose}>YEREL SAHNEYİ AÇ</button></>}
        {selection.kind === "kingdom" && selectedKingdom && <><span className="inspector-kicker">{selectedKingdom.discovered ? "KEŞFEDİLMİŞ BÖLGE" : "SİS ALTINDAKİ BÖLGE"}</span><div className={`region-portrait ${selectedKingdom.terrain}`}><i>{selectedKingdom.discovered ? "♜" : "?"}</i></div><h3>{selectedKingdom.name ?? "Bilinmeyen Sancak"}</h3><p>{terrainNames[selectedKingdom.terrain] ?? "Bilinmeyen"} bölgesi · koordinat {selectedKingdom.position.x}, {selectedKingdom.position.z}</p>{selectedKingdom.report ? <><dl><div><dt>Hükümdar</dt><dd>{selectedKingdom.report.ruler}</dd></div><div><dt>Kale</dt><dd>Sv.{selectedKingdom.report.keepLevel}</dd></div><div><dt>Nüfus</dt><dd>{selectedKingdom.report.population}</dd></div><div><dt>Ordu</dt><dd>{selectedKingdom.report.army}</dd></div><div><dt>Yapı</dt><dd>{selectedKingdom.report.buildingCount}</dd></div></dl>{/* Keşif kalıcıdır, rapor değil: donmuş bir anlık görüntüdür ve yaşı taşınır. */}<p className="report-age">{selectedKingdom.reportAt ? `Rapor ${reportAge(selectedKingdom.reportAt)} önce alındı${selectedKingdom.reportStale ? " · BAYAT, yeniden keşif gerekir" : ""}.` : "Rapor tarihi bilinmiyor."}</p></> : <div className="fog-report">Bölgenin içeriği harita sisinin altında. Ajan başarılı olursa hükümdar, kale, nüfus, ordu ve yapı bilgileri görünür.</div>}{selectedKingdom.mission?.status === "pending" ? <button className="inspector-action" disabled>AJAN YOLDA · {formatLeft(selectedKingdom.mission.completesAt)}</button> : <button className="inspector-action" disabled={busy} onClick={() => onScout(selectedKingdom.id)}>{selectedKingdom.discovered ? "YENİDEN KEŞİF YAP" : "AJAN GÖNDER"}</button>}</>}
        {selection.kind === "mine" && sharedMine && <><span className="inspector-kicker">CHANNEL ORTAK SAHASI</span><div className="region-portrait mine"><i>⛏</i></div><h3>{sharedMine.mine.name}</h3><p>Aynı channel&apos;daki krallıkların birlikte işletebildiği cevher sahası.</p><dl><div><dt>Çıkarılan</dt><dd>{Math.round(sharedMine.mine.extractedOre)}</dd></div><div><dt>Kalan</dt><dd>{Math.round(sharedMine.mine.oreRemaining)}</dd></div><div><dt>İşçi</dt><dd>{sharedMine.mine.totalWorkers}</dd></div></dl><div className="mine-roster">{sharedMine.participants.length ? sharedMine.participants.map(participant => <span key={participant.id}>{participant.name} · {participant.workers} işçi</span>) : <span>Henüz çalışan krallık yok.</span>}</div><button className="inspector-action" disabled={busy} onClick={() => onMine(joinedMine ? "leave" : "join")}>{joinedMine ? "İŞÇİLERİ GERİ ÇAĞIR" : "5 İŞÇİ GÖNDER"}</button></>}
      </aside>
    </div>
  </div>;
}
