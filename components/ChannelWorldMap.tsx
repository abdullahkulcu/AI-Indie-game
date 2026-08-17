"use client";

import { useState } from "react";
import { BIOMES, biomeFeatures } from "@/engine/world-map";

type IntelReport = { ruler: string; keepLevel: number; population: number; buildingCount: number; army: number };
type WorldKingdom = { id: string; name: string | null; terrain: string; position: { x: number; z: number }; ring?: number; discovered: boolean; mission: { status: "pending" | "succeeded" | "failed" | "detected"; completesAt: number; successChance: number } | null; report: IntelReport | null };
type SharedMine = { mine: { name: string; oreRemaining: number; extractedOre: number; totalWorkers: number; position: { x: number; z: number } }; participants: Array<{ id: string; name: string; workers: number; self: boolean }> };
type Selection = { kind: "home" } | { kind: "kingdom"; id: string } | { kind: "mine" };

const terrainNames: Record<string, string> = { plain: "Ova", forest: "Orman", mountain: "Dağ", riverbank: "Nehir Kıyısı" };

/** Dünya koordinatını harita yüzdesine çevirir. `extent` büyüdükçe görüş alanı açılır. */
const project = (value: number, extent: number) => 50 + (value / Math.max(1, extent)) * 42;

export default function ChannelWorldMap({ channelName, homeName, homeTerrain, homePosition, homeKeepLevel, extent, kingdoms, sharedMine, busy, formatLeft, onClose, onScout, onMine }: {
  channelName: string; homeName: string; homeTerrain: string; kingdoms: WorldKingdom[]; sharedMine: SharedMine | null; busy: boolean;
  homePosition?: { x: number; z: number; ring: number; biome: string }; homeKeepLevel?: number; extent?: number;
  formatLeft: (at: number) => string; onClose: () => void; onScout: (id: string) => void; onMine: (action: "join" | "leave") => void;
}) {
  const [selection, setSelection] = useState<Selection>({ kind: "home" });
  const home = homePosition ?? { x: 0, z: 0, ring: 0, biome: homeTerrain };
  // Görüş alanı en dıştaki krallığa göre açılır; dünya büyüdükçe harita da büyür.
  const span = extent ?? 60;
  // conic-gradient 12 yönünden saat yönünde başlar; harita açısı ise doğudan.
  const biomeTints: Record<string, string> = {
    plain: "rgba(140,158,88,.40)", forest: "rgba(52,86,54,.46)",
    mountain: "rgba(116,110,98,.46)", riverbank: "rgba(74,116,132,.42)",
  };
  const biomeGradient = `conic-gradient(from 90deg at 50% 50%, ${BIOMES
    .flatMap(biome => {
      const from = biome.centerAngle - biome.spread / 2, to = biome.centerAngle + biome.spread / 2;
      return [`transparent ${from}deg`, `${biomeTints[biome.id]} ${from}deg`, `${biomeTints[biome.id]} ${to}deg`, `transparent ${to}deg`];
    })
    .join(", ")})`;
  const selectedKingdom = selection.kind === "kingdom" ? kingdoms.find(kingdom => kingdom.id === selection.id) ?? null : null;
  const joinedMine = Boolean(sharedMine?.participants.some(participant => participant.self));
  const regionCount = kingdoms.length + 1 + (sharedMine ? 1 : 0);

  return <div className="channel-map-overlay" role="dialog" aria-modal="true" aria-label={`${channelName} channel haritası`}>
    <header className="channel-map-header"><div><span>STRATEJİK DÜNYA GÖRÜNÜMÜ</span><h2>{channelName}</h2><p>{regionCount} bölge · Krallık isimleri başarılı keşiften sonra açılır</p></div><button onClick={onClose}>BAŞKENTE DÖN ✕</button></header>
    <div className="channel-map-layout">
      <section className="channel-map-canvas">
        {/* Dünyanın sabit coğrafyası: dört biyom kuşağı merkezden dışa doğru uzanır. */}
        <div className="map-biomes" aria-hidden="true" style={{ background: biomeGradient }}/>
        <div className="map-biome-labels" aria-hidden="true">
          {BIOMES.map(biome => {
            const angle = biome.centerAngle * Math.PI / 180;
            return <em key={biome.id} className={biome.id} style={{ left: `${50 + Math.cos(angle) * 38}%`, top: `${50 + Math.sin(angle) * 38}%` }}>{biome.label}</em>;
          })}
        </div>
        <div className="map-features" aria-hidden="true">
          {biomeFeatures(channelName, span).map((feature, index) =>
            <span key={index} className={feature.biome} style={{ left: `${project(feature.x, span)}%`, top: `${project(feature.z, span)}%`, fontSize: `${feature.size}px` }}>{feature.glyph}</span>)}
        </div>
        <div className="map-rings" aria-hidden="true">{[1, 2, 3, 4, 5].map(ring => <i key={ring} style={{ width: `${ring * 17}%`, height: `${ring * 17}%` }}/>)}</div>
        <div className="map-river"/><div className="map-road road-a"/><div className="map-road road-b"/>
        <button className={`map-region home ${selection.kind === "home" ? "selected" : ""} ${homeTerrain}`} style={{ left: `${project(home.x, span)}%`, top: `${project(home.z, span)}%` }} onClick={() => setSelection({ kind: "home" })}><i className={`castle keep-${Math.min(6, homeKeepLevel ?? 1)}`}>♜</i><b>{homeName}</b><small>BAŞKENTİN</small></button>
        {kingdoms.map((kingdom, index) => <button key={kingdom.id} className={`map-region kingdom ${kingdom.terrain} ${kingdom.discovered ? "discovered" : "unknown"} ${selection.kind === "kingdom" && selection.id === kingdom.id ? "selected" : ""}`} style={{ left: `${project(kingdom.position.x, span)}%`, top: `${project(kingdom.position.z, span)}%`, zIndex: 20 + index }} onClick={() => setSelection({ kind: "kingdom", id: kingdom.id })}><i className={`castle ${kingdom.discovered ? `keep-${Math.min(6, kingdom.report?.keepLevel ?? 1)}` : "unscouted"}`}>♜</i><b>{kingdom.name ?? "Bilinmeyen Sancak"}</b><small>{kingdom.discovered ? `Kale Sv.${kingdom.report?.keepLevel ?? 1}` : terrainNames[kingdom.terrain] ?? "Bölge"}</small></button>)}
        {sharedMine && <button className={`map-region mine ${selection.kind === "mine" ? "selected" : ""}`} style={{ left: `${project(sharedMine.mine.position.x, span)}%`, top: `${project(sharedMine.mine.position.z, span)}%` }} onClick={() => setSelection({ kind: "mine" })}><i>⛏</i><b>{sharedMine.mine.name}</b><small>{sharedMine.mine.totalWorkers} İŞÇİ</small></button>}
        <div className="map-compass"><b>K</b><span>✦</span><small>G</small></div><div className="channel-map-legend"><span><i className="legend-home"/> Senin krallığın</span><span><i className="legend-unknown"/> Keşfedilmemiş</span><span><i className="legend-mine"/> Ortak saha</span></div>
      </section>
      <aside className="region-inspector">
        {selection.kind === "home" && <><span className="inspector-kicker">MERKEZ BÖLGE</span><div className={`region-portrait ${homeTerrain}`}><i>♜</i></div><h3>{homeName}</h3><p>{terrainNames[homeTerrain] ?? "Başkent"} arazisindeki kendi yönetim merkeziniz.</p><dl><div><dt>Konum</dt><dd>Harita merkezi</dd></div><div><dt>Durum</dt><dd>Yönetiminizde</dd></div><div><dt>Görüş</dt><dd>Tam</dd></div></dl><button className="inspector-action" onClick={onClose}>YEREL SAHNEYİ AÇ</button></>}
        {selection.kind === "kingdom" && selectedKingdom && <><span className="inspector-kicker">{selectedKingdom.discovered ? "KEŞFEDİLMİŞ BÖLGE" : "SİS ALTINDAKİ BÖLGE"}</span><div className={`region-portrait ${selectedKingdom.terrain}`}><i>{selectedKingdom.discovered ? "♜" : "?"}</i></div><h3>{selectedKingdom.name ?? "Bilinmeyen Sancak"}</h3><p>{terrainNames[selectedKingdom.terrain] ?? "Bilinmeyen"} bölgesi · koordinat {selectedKingdom.position.x}, {selectedKingdom.position.z}</p>{selectedKingdom.report ? <dl><div><dt>Hükümdar</dt><dd>{selectedKingdom.report.ruler}</dd></div><div><dt>Kale</dt><dd>Sv.{selectedKingdom.report.keepLevel}</dd></div><div><dt>Nüfus</dt><dd>{selectedKingdom.report.population}</dd></div><div><dt>Ordu</dt><dd>{selectedKingdom.report.army}</dd></div><div><dt>Yapı</dt><dd>{selectedKingdom.report.buildingCount}</dd></div></dl> : <div className="fog-report">Bölgenin içeriği harita sisinin altında. Ajan başarılı olursa hükümdar, kale, nüfus, ordu ve yapı bilgileri görünür.</div>}{selectedKingdom.mission?.status === "pending" ? <button className="inspector-action" disabled>AJAN YOLDA · {formatLeft(selectedKingdom.mission.completesAt)}</button> : <button className="inspector-action" disabled={busy} onClick={() => onScout(selectedKingdom.id)}>{selectedKingdom.discovered ? "YENİDEN KEŞİF YAP" : "AJAN GÖNDER"}</button>}</>}
        {selection.kind === "mine" && sharedMine && <><span className="inspector-kicker">CHANNEL ORTAK SAHASI</span><div className="region-portrait mine"><i>⛏</i></div><h3>{sharedMine.mine.name}</h3><p>Aynı channel&apos;daki krallıkların birlikte işletebildiği cevher sahası.</p><dl><div><dt>Çıkarılan</dt><dd>{Math.round(sharedMine.mine.extractedOre)}</dd></div><div><dt>Kalan</dt><dd>{Math.round(sharedMine.mine.oreRemaining)}</dd></div><div><dt>İşçi</dt><dd>{sharedMine.mine.totalWorkers}</dd></div></dl><div className="mine-roster">{sharedMine.participants.length ? sharedMine.participants.map(participant => <span key={participant.id}>{participant.name} · {participant.workers} işçi</span>) : <span>Henüz çalışan krallık yok.</span>}</div><button className="inspector-action" disabled={busy} onClick={() => onMine(joinedMine ? "leave" : "join")}>{joinedMine ? "İŞÇİLERİ GERİ ÇAĞIR" : "5 İŞÇİ GÖNDER"}</button></>}
      </aside>
    </div>
  </div>;
}
