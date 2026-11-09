"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { unitCatalog, type UnitType } from "@/engine/units";
import type { Game, TerrainId } from "@/engine/types";
import { DEFENSE_DOCTRINES, KING_LEADS_MORALE_BONUS, WAR_APPROACHES, WAR_OBJECTIVES, kingAbsencePenalty, type DefenseDoctrine, type WarApproach, type WarObjective } from "@/engine/war";

type Target = { id: string; name: string | null; terrain: string; discovered: boolean; report: { army: number; keepLevel: number } | null };
type Army = { side: "attacker" | "defender"; units: Partial<Record<UnitType, number>>; supply: number; initialSupply: number; morale: number; approach: string; withdrawThreshold: number };
type War = { id: string; objective: WarObjective; status: string; targetTerrain: TerrainId; distance: number; marchHours: number; departsAt: number; arrivesAt: number; battlePhase: number; nextBattleAt: number | null; returnsAt: number | null; siegeEndsAt: number | null; blockadeSettledAt: number | null; blockadePressure: number; warPoints: number; outcome: "attacker" | "defender" | "draw" | null; role: "attacker" | "defender"; defenderCivicResponse: "support" | "watch" | "pressure"; defenderMoraleBonus: number; kingLeads: boolean; armies: Army[]; events: Array<{ sequence: number; kind: string; message: string; at: number }> };
type Report = { id: string; warId: string; kind: string; summary: string; createdAt: number; availableAt: number; readAt: number | null };
type SupportableWar = { id: string; objective: WarObjective; status: string; targetTerrain: TerrainId; attackerName: string; defenderName: string };
type Dashboard = { wars: War[]; reports: Report[]; couriers: Array<{ warId: string; availableAt: number }>; supportableWars: SupportableWar[]; doctrine: DefenseDoctrine };
type SupplyPlan = { oneWayGameHours: number; battleGameHours: number; outboundFood: number; battleFood: number; returnFood: number; baseFood: number; safetyFood: number; totalFood: number };
type Preview = { distance: number; gameHours: number; gatheringMs: number; marchMs: number; minimumSupply: number; supply: number; supplyPlan: SupplyPlan };
export type CampaignDraft = { targetId: string; objective: WarObjective; approach: WarApproach; withdrawThreshold: number; recommendedUnits: string; rationale: string };

/** Worker hata sayfası ya da ters vekil boş yanıt döndürse bile ham JSON
 * ayrıştırma hatasını Kral'a göstermeyiz. */
async function readWarResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  if (!raw.trim()) throw new Error(response.ok ? "Savaş defteri boş yanıt verdi; sayfayı yenileyin." : "Savaş defteri şu anda yanıt veremiyor; kısa süre sonra tekrar deneyin.");
  try { return JSON.parse(raw) as T; }
  catch { throw new Error(response.ok ? "Savaş defteri geçersiz bir yanıt verdi; sayfayı yenileyin." : "Savaş defteri şu anda yanıt veremiyor; kısa süre sonra tekrar deneyin."); }
}

const objectiveLabel: Record<WarObjective, { title: string; note: string }> = {
  raid: { title: "Yağma", note: "Kısa sefer; sınırlı kaynak hedefi." },
  concession: { title: "Tavize zorlama", note: "Savaş puanıyla diplomatik baskı." },
  siege: { title: "Kale baskısı", note: "Saha zaferinden sonra kuşatma yolu." },
  blockade: { title: "Abluka", note: "Sınırda kal; erzakla zaman baskısı kur." },
};
const approachLabel: Record<WarApproach, string> = { cautious: "Temkinli", balanced: "Dengeli", intense: "Yoğun" };
const doctrineLabel: Record<DefenseDoctrine, string> = { cautious: "Temkinli savunma", balanced: "Dengeli savunma", hard_response: "Sert karşılık" };
const statusLabel: Record<string, string> = { gathering: "TOPLANIYOR", marching: "YÜRÜYOR", engaged: "ÇATIŞMA SAFHASI", siege: "KUŞATMA", blockade: "ABLUKA", returning: "DÖNÜYOR", resolved: "SONUÇLANDI", cancelled: "İPTAL" };
const civicLabel = { support: "HALK DESTEĞİ", watch: "HALK İZLİYOR", pressure: "BARIŞ BASKISI" } as const;
const civicAction = { support: "MAHALLE SAVUNMASI", watch: "MAHALLE NÖBETİ", pressure: "BARIŞ HEYETİ" } as const;
const timeLeft = (at: number | null, now: number) => {
  if (!at) return "—";
  const seconds = Math.max(0, Math.ceil((at - now) / 1_000));
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}sa ${Math.floor(seconds % 3600 / 60)}dk` : `${Math.floor(seconds / 60)}dk ${seconds % 60}sn`;
};
const durationLabel = (durationMs: number) => {
  const totalMinutes = Math.max(0, Math.ceil(durationMs / 60_000));
  const days = Math.floor(totalMinutes / 1_440), hours = Math.floor(totalMinutes % 1_440 / 60), minutes = totalMinutes % 60;
  if (days) return `${days} gün${hours ? ` ${hours} sa` : ""}`;
  return hours ? `${hours} sa${minutes ? ` ${minutes} dk` : ""}` : `${minutes} dk`;
};
const reportTime = (at: number) => new Date(at).toLocaleString("tr-TR");

export default function WarCampaignWorkspace({ game, targets, initialTargetId, initialDraft, onOpenNegotiation }: { game: Game; targets: Target[]; initialTargetId?: string | null; initialDraft?: CampaignDraft | null; onOpenNegotiation?: (id: string) => void }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [targetId, setTargetId] = useState(initialDraft?.targetId ?? initialTargetId ?? "");
  const [objective, setObjective] = useState<WarObjective>(initialDraft?.objective ?? "raid");
  const [approach, setApproach] = useState<WarApproach>(initialDraft?.approach ?? "balanced");
  const [withdrawThreshold, setWithdrawThreshold] = useState(initialDraft?.withdrawThreshold ?? 50);
  const [units, setUnits] = useState<Partial<Record<UnitType, number>>>({});
  const [supply, setSupply] = useState("");
  const [supportFood, setSupportFood] = useState("50");
  const [supportTroops, setSupportTroops] = useState<Partial<Record<UnitType, number>>>({});
  const [reinforcements, setReinforcements] = useState<Partial<Record<UnitType, number>>>({});
  const [kingLeads, setKingLeads] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const targetsDiscovered = useMemo(() => targets.filter(target => target.discovered), [targets]);

  useEffect(() => {
    const refreshClock = () => setNow(Date.now());
    const initial = window.setTimeout(refreshClock, 0);
    const timer = window.setInterval(refreshClock, 1_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, []);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/war", { cache: "no-store" });
      const data = await readWarResponse<Dashboard & { error?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? "Savaş defteri okunamadı.");
      setDashboard(data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Savaş defteri okunamadı."); }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 15_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [load]);
  const send = async (body: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/war", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await readWarResponse<{ error?: string; preview?: Preview; negotiationId?: string }>(response);
      if (!response.ok) throw new Error(data.error ?? "Sefer emri işlenemedi.");
      if (data.preview) setPreview(data.preview);
      await load();
      if (data.negotiationId) onOpenNegotiation?.(data.negotiationId);
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Sefer emri işlenemedi."); return false; }
    finally { setBusy(false); }
  };
  const planBody = () => ({ targetId, objective, units, approach, withdrawThreshold, supply: supply ? Number(supply) : undefined, kingLeads });
  const selectedTarget = targetsDiscovered.find(target => target.id === targetId) ?? null;
  const active = dashboard?.wars.filter(war => !["resolved", "cancelled"].includes(war.status)) ?? [];
  const concludedWithoutPeace = dashboard?.wars.filter(war => war.status === "resolved" && !war.events.some(event => event.kind === "peace_offer")) ?? [];

  return <div className="campaign-workspace">
    <header className="page-heading"><div><span>SEFER MASASI</span><h3>Ordu emri</h3></div><p>Önce amaç, hedef ve birlikleri seçin. General plan önerebilir; savaş ilanını yalnız Kralın mührü başlatır.</p></header>
    {error && <p className="campaign-error">{error}</p>}
    {initialDraft && <section className="campaign-general-draft"><span>GENERAL TASLAĞI</span><p>{initialDraft.rationale}</p><small>Önerilen birlikler: {initialDraft.recommendedUnits}. Aşağıdaki bütün seçimleri değiştirebilir, ancak ardından kendi mührünüzle sefer başlatabilirsiniz.</small></section>}
    <section className="war-command-strip"><label>Savunma doktrini<select value={dashboard?.doctrine ?? "balanced"} disabled={busy} onChange={event => void send({ action: "set_doctrine", doctrine: event.target.value })}>{DEFENSE_DOCTRINES.map(doctrine => <option key={doctrine} value={doctrine}>{doctrineLabel[doctrine]}</option>)}</select></label><small>Çevrimdışıyken Generaliniz bu yaklaşımı uygular.</small></section>
    {active.filter(war => war.status === "blockade").map(war => {
      const attackerArmy = war.armies.find(army => army.side === "attacker");
      const isAttacker = war.role === "attacker";
      return <section className="war-settlement blockade-status" key={`blockade:${war.id}`}>
        <span>AÇIK ABLUKA · SINIR HATTI</span>
        <p>{isAttacker
          ? `Ordu sınırda bekliyor. ${attackerArmy?.supply ?? 0} yiyecek kaldı; ikmal bitince kuvvet dönüşe geçer.`
          : `Sınırda açık abluka var. Baskı ${war.blockadePressure} kez hissedildi; nöbet, erzak ve halkın huzurunu izleyin.`}</p>
        <article><p><b>{isAttacker ? "Baskıyı sona erdir" : "Savunma hazırlığı"}</b> · {isAttacker ? "Birlikler dönüş yoluna çıkar; kalan erzakla birlikte garnizona döner." : "Geleneksel savunma doktrini ve garnizon düzeni, abluka sürerken de geçerlidir."}</p>{isAttacker && <button disabled={busy} onClick={() => void send({ action: "withdraw", warId: war.id })}>ABLUKAYI KALDIR</button>}</article>
      </section>;
    })}
    {active.length > 0 && <section className="active-wars">{active.map(war => {
      const mine = war.role === "attacker";
      const deadline = war.status === "gathering" ? war.departsAt : war.status === "marching" ? war.arrivesAt : war.status === "engaged" ? war.nextBattleAt : war.status === "siege" ? war.siegeEndsAt : war.status === "returning" ? war.returnsAt : null;
      const peaceOffered = war.events.some(event => event.kind === "peace_offer");
      const truceAccepted = war.events.some(event => event.kind === "truce");
      const courier = dashboard?.couriers.find(item => item.warId === war.id);
      const defenseArmy = war.armies.find(army => army.side === "defender");
      const ownArmy = war.armies.find(army => army.side === (mine ? "attacker" : "defender"));
      const fieldStrength = ownArmy ? Object.values(ownArmy.units).reduce((sum, count) => sum + (count ?? 0), 0) : 0;
      const reserveUnits = !mine && defenseArmy ? unitCatalog.map(unit => ({ unit, available: Math.max(0, (game.units[unit.type] ?? 0) - (defenseArmy.units[unit.type] ?? 0)) })).filter(item => item.available > 0) : [];
      const chosenReinforcements = Object.values(reinforcements).reduce((sum, amount) => sum + (amount ?? 0), 0);
      const commandWindow = mine && ["marching", "engaged"].includes(war.status);
      const phaseLabel = war.status === "engaged" ? ` · ${Math.min(3, war.battlePhase + 1)}/3` : "";
      const absencePenalty = mine && war.kingLeads
        ? kingAbsencePenalty(true, Math.max(0, now - war.departsAt) * Math.max(1, game.speed) / 3_600_000)
        : 0;
      return <article key={war.id}>
        <div><span>{mine ? "SİZİN SEFERİNİZ" : "SINIR UYARISI"}</span><h4>{courier ? "HABERCİ BEKLENİYOR" : `${statusLabel[war.status] ?? war.status}${phaseLabel}`}</h4><p>{courier ? `Saha haberi yaklaşık ${timeLeft(courier.availableAt, now)} sonra ulaşacak.` : deadline ? `Bir sonraki aşama: ${timeLeft(deadline, now)}` : "Generalin yeni saha değerlendirmesi bekleniyor."}</p></div>
        <dl>
          <dt>Amaç</dt><dd>{objectiveLabel[war.objective].title}</dd><dt>Mesafe</dt><dd>{war.distance.toFixed(1)} birim</dd><dt>Yol</dt><dd>{war.marchHours.toFixed(1)} oyun saati</dd><dt>Takvim</dt><dd>{durationLabel(Math.max(0, war.arrivesAt - war.departsAt))}</dd><dt>Savaş puanı</dt><dd>{courier ? "BİLİNMİYOR" : war.warPoints > 0 ? `+${war.warPoints}` : war.warPoints}</dd>
          {ownArmy && <><dt>Sahadaki birlik</dt><dd>{fieldStrength} birlik · moral %{Math.round(ownArmy.morale)} · {ownArmy.supply} yiyecek</dd></>}
          {mine && war.kingLeads && <><dt>Komuta</dt><dd>KRAL CEPHEDE · moral +{KING_LEADS_MORALE_BONUS}</dd></>}
          {mine && war.kingLeads && <><dt>Başkent</dt><dd>NAİPLİKTE · büyük kararlar dönüşe ertelendi{absencePenalty ? ` · dönüşte ${absencePenalty} rıza yıpranması` : ""}</dd></>}
          {!mine && <><dt>Halkın tavrı</dt><dd>{civicLabel[war.defenderCivicResponse]} · {civicAction[war.defenderCivicResponse]}{war.defenderMoraleBonus ? ` · moral ${war.defenderMoraleBonus > 0 ? "+" : ""}${war.defenderMoraleBonus}` : ""}</dd><dt>Halkın etkisi</dt><dd>Geri çekilme eşiği %{ownArmy?.withdrawThreshold ?? 50}</dd></>}
        </dl>
        <div className="campaign-war-actions">
          {commandWindow && <><button disabled={busy} onClick={() => void send({ action: "field_command", warId: war.id, command: "advance" })}>İLERLEME EMRİ</button><button disabled={busy} onClick={() => void send({ action: "field_command", warId: war.id, command: "hold" })}>MEVZİDE KAL</button><button disabled={busy} onClick={() => void send({ action: "field_command", warId: war.id, command: "withdraw" })}>GERİ ÇEKİLME EMRİ</button></>}
          {mine && !commandWindow && !["returning", "resolved", "cancelled"].includes(war.status) && <button disabled={busy} onClick={() => void send({ action: "withdraw", warId: war.id })}>GERİ ÇEKİL</button>}
          {!mine && war.status === "siege" && <button disabled={busy} onClick={() => void send({ action: "sally", warId: war.id })}>HURUÇ YAP</button>}
          {!mine && war.status === "returning" && war.outcome === "defender" && !courier && <button disabled={busy} onClick={() => void send({ action: "pursue", warId: war.id })}>GERİ ÇEKİLEN ORDUYU TAKİP ET</button>}
          {["marching", "engaged", "siege", "blockade", "returning"].includes(war.status) && !peaceOffered && !courier && <button disabled={busy} onClick={() => void send({ action: "offer_peace", warId: war.id })}>{war.status === "returning" ? "BARIŞ ŞARTI SUN" : "ATEŞKES ŞARTI SUN"}</button>}
          {war.status === "returning" && courier && <small>Barış şartı için saha haberi bekleniyor.</small>}{peaceOffered && !truceAccepted && <small>Barış belgesi müzakere masasına bırakıldı.</small>}{truceAccepted && <small>Ateşkes imzalandı; ordu dönüş yolunda.</small>}
        </div>
        {!mine && ["gathering", "marching", "engaged"].includes(war.status) && <section className="defense-reinforcement"><b>SAVUNMA TAKVİYESİ</b>{reserveUnits.length ? <><p>Uyarıdan sonra eğitimi biten birlikleri savunma hattına ekleyin. Mevcut garnizon zaten hattadır; aynı birlik ikinci kez seçilemez.</p><div>{reserveUnits.map(({ unit, available }) => <label key={unit.type}>{unit.name} · {available} yeni <input type="number" min="0" max={available} value={reinforcements[unit.type] || ""} placeholder="0" onChange={event => setReinforcements(current => ({ ...current, [unit.type]: Math.max(0, Math.min(available, Math.floor(Number(event.target.value) || 0))) }))}/></label>)}</div><button disabled={busy || !chosenReinforcements} onClick={() => void send({ action: "reinforce_defense", warId: war.id, reinforcementUnits: reinforcements }).then(ok => { if (ok) setReinforcements({}); })}>SAVUNMA HATTINA KAT</button></> : <small>Bu tehditten sonra eğitimini bitirmiş yeni birlik yok; mevcut garnizon savunma hattında.</small>}</section>}
        <ol>{war.events.map(event => <li key={event.sequence}>{event.message}</li>)}</ol>
      </article>;
    })}</section>}
    {dashboard?.supportableWars.length ? <section className="war-settlement"><span>UZAK SAVAŞLAR · DESTEK KARARI</span><p>İkmal konvoyu varışta ordunun erzağını ve moralini güçlendirir. Savunana gönüllü birlik yollamak askerleri cepheye taşır; hayatta kalanlar savaş bitince geri döner. Saldırana geçiş hakkı ise yalnız hedefe varmadan verilir ve rota süresini kısaltır. Savunmaya yardım itibar kazandırır; saldırana ikmal veya geçiş hakkı vermek itibar bedeli taşır.</p><label>Gönderilecek yiyecek<input type="number" min="10" value={supportFood} onChange={event => setSupportFood(event.target.value)} /></label><div className="support-troops">{unitCatalog.filter(unit => (game.units[unit.type] ?? 0) > 0).map(unit => <label key={unit.type}>{unit.name} · {game.units[unit.type] ?? 0}<input type="number" min="0" max={game.units[unit.type] ?? 0} value={supportTroops[unit.type] || ""} placeholder="0" onChange={event => setSupportTroops(current => ({ ...current, [unit.type]: Math.max(0, Math.min(game.units[unit.type] ?? 0, Math.floor(Number(event.target.value) || 0))) }))}/></label>)}</div>{dashboard.supportableWars.map(war => <article key={war.id}><p><b>{war.attackerName}</b> → <b>{war.defenderName}</b> · {objectiveLabel[war.objective].title} · {statusLabel[war.status] ?? war.status}</p><button disabled={busy} onClick={() => void send({ action: "support_supply", warId: war.id, side: "attacker", food: Number(supportFood) })}>SALDIRANA İKMAL GÖNDER</button><button disabled={busy} onClick={() => void send({ action: "support_supply", warId: war.id, side: "defender", food: Number(supportFood) })}>SAVUNANA İKMAL GÖNDER</button><button disabled={busy || !Object.values(supportTroops).some(count => count && count > 0) || !["gathering", "marching", "engaged", "siege", "blockade"].includes(war.status)} onClick={() => void send({ action: "support_troops", warId: war.id, supportUnits: supportTroops }).then(ok => { if (ok) setSupportTroops({}); })}>SAVUNANA BİRLİK GÖNDER</button><button disabled={busy || !["gathering", "marching"].includes(war.status)} onClick={() => void send({ action: "support_passage", warId: war.id })}>SALDIRANA GEÇİŞ HAKKI VER</button></article>)}</section> : null}
    {concludedWithoutPeace.length > 0 && <section className="war-settlement"><span>SAVAŞ SONRASI</span>{concludedWithoutPeace.map(war => <article key={war.id}><p>Bu sefer sonuçlandı. {war.warPoints > 0 ? `Elinizde +${war.warPoints} savaş puanı var.` : war.warPoints < 0 ? `Karşı tarafın ${Math.abs(war.warPoints)} savaş puanı üstünlüğü var.` : "Taraflar başa baş kaldı."}</p><button disabled={busy} onClick={() => void send({ action: "offer_peace", warId: war.id })}>BARIŞ BELGESİ HAZIRLA</button></article>)}</section>}
    <section className="campaign-planner">
      <div className="campaign-step"><span>1 · AMAÇ</span><div>{WAR_OBJECTIVES.map(item => <button className={objective === item ? "active" : ""} key={item} onClick={() => { setObjective(item); setPreview(null); }}><b>{objectiveLabel[item].title}</b><small>{objectiveLabel[item].note}</small></button>)}</div></div>
      <div className="campaign-step"><span>2 · HEDEF</span><select value={targetId} onChange={event => { setTargetId(event.target.value); setPreview(null); }}><option value="">Keşfedilmiş krallık seçin…</option>{targetsDiscovered.map(target => <option key={target.id} value={target.id}>{target.name ?? "Bilinmeyen sancak"} · {target.terrain}</option>)}</select>{selectedTarget ? <small>İstihbarat raporu: Kale Sv.{selectedTarget.report?.keepLevel ?? "?"} · yaklaşık {selectedTarget.report?.army ?? "?"} birlik.</small> : <small>Sefer için önce Diyar haritasında başarılı keşif gereklidir.</small>}</div>
      <div className="campaign-step"><span>3 · BİRLİKLER</span><div className="campaign-units">{unitCatalog.map(unit => { const available = game.units[unit.type] ?? 0, chosen = units[unit.type] ?? 0; return <label key={unit.type}><b>{unit.name}</b><small>{available} garnizonda · hız {unit.speed}</small><input type="number" min="0" max={available} value={chosen || ""} placeholder="0" onChange={event => { const count = Math.max(0, Math.min(available, Math.floor(Number(event.target.value) || 0))); setUnits(current => ({ ...current, [unit.type]: count })); setPreview(null); }}/></label>; })}</div></div>
      <div className="campaign-step campaign-settings"><span>4 · YAKLAŞIM, İKMAL VE KOMUTA</span><label>Yaklaşım<select value={approach} onChange={event => { setApproach(event.target.value as WarApproach); setPreview(null); }}>{WAR_APPROACHES.map(item => <option key={item} value={item}>{approachLabel[item]}</option>)}</select></label><label>Geri çekilme eşiği <input type="range" min="20" max="80" value={withdrawThreshold} onChange={event => { setWithdrawThreshold(Number(event.target.value)); setPreview(null); }}/><b>%{withdrawThreshold}</b></label><label>Taşınacak yiyecek<input type="number" min="0" value={supply} placeholder="Otomatik en az" onChange={event => { setSupply(event.target.value); setPreview(null); }}/></label><label>Kralın komutası<select value={kingLeads ? "front" : "capital"} onChange={event => { setKingLeads(event.target.value === "front"); setPreview(null); }}><option value="capital">General komuta eder</option><option value="front">Kral cephede komuta eder</option></select><small>{kingLeads ? `Saha sonucu anında gelir, ilk temasta moral +${KING_LEADS_MORALE_BONUS}. Uzayan sefer başkentte rıza kaybı yaratır.` : "Saha sonucu haberciyle gelir; başkentte siyasi yük oluşmaz."}</small></label></div>
      {preview && <div className="campaign-preview"><b>SEFER HESABI</b><span>{preview.distance.toFixed(1)} birim · {preview.gameHours.toFixed(1)} oyun saati yol · takvimde yaklaşık {durationLabel(preview.marchMs)}</span><span>{durationLabel(preview.gatheringMs)} hazırlık · en az {preview.minimumSupply} yiyecek</span><dl><div><dt>Gidiş</dt><dd>{preview.supplyPlan.outboundFood} yiyecek</dd></div><div><dt>Mücadele</dt><dd>{preview.supplyPlan.battleFood} yiyecek</dd></div><div><dt>Dönüş</dt><dd>{preview.supplyPlan.returnFood} yiyecek</dd></div><div><dt>Güvenlik payı</dt><dd>+{preview.supplyPlan.safetyFood} · %20</dd></div></dl></div>}
      <footer><button disabled={busy || !targetId || active.length > 0} onClick={() => void send({ action: "plan", ...planBody() })}>SEFERİ HESAPLA</button><button className="campaign-seal" disabled={busy || !preview || active.length > 0} onClick={() => void send({ action: "declare", ...planBody() })}>SEFER MÜHRÜNÜ VUR</button></footer>
    </section>
    <section className="war-reports"><header><span>SAVAŞ DEFTERİ</span><b>{dashboard?.reports.filter(report => !report.readAt).length ?? 0} okunmamış</b>{dashboard?.couriers.length ? <small>{dashboard.couriers.length} HABERCİ YOLDA · ilki {timeLeft(Math.min(...dashboard.couriers.map(courier => courier.availableAt)), now)} sonra</small> : null}</header>{dashboard?.reports.length ? dashboard.reports.slice().reverse().map(report => <article className={report.readAt ? "" : "unread"} key={report.id}><p>{report.summary}</p><small>{report.availableAt > report.createdAt ? <>Sahadan: {reportTime(report.createdAt)} · Saraya ulaştı: {reportTime(report.availableAt)}</> : <>Saraya ulaştı: {reportTime(report.availableAt)}</>}</small>{!report.readAt && <button disabled={busy} onClick={() => void send({ action: "read_report", reportId: report.id })}>OKUDUM</button>}</article>) : <p>{dashboard?.couriers.length ? "Saha sonucu için haberci bekleniyor." : "Henüz savaş haberi yok."}</p>}</section>
  </div>;
}
