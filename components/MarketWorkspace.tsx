"use client";

import { useMemo, useState } from "react";
import { marketState } from "@/engine/actions";
import { fillOrder, livingCostMood, maxPurchase, type TradeKey } from "@/engine/market";
import type { Game } from "@/engine/types";

const rows: Array<[TradeKey, string]> = [["food", "Yiyecek"], ["wood", "Odun"], ["stone", "Taş"], ["iron", "Demir"], ["ale", "Bira"]];

export default function MarketWorkspace({ game, now, channelIndex, connecting, formatLeft, onClose, onSubmit, embedded = false }: {
  game: Game; now: number; channelIndex?: Partial<Record<TradeKey, number>>; connecting: boolean;
  formatLeft: (at: number) => string; onClose: () => void; onSubmit: (order: string) => void; embedded?: boolean;
}) {
  const market = marketState(game, now, channelIndex);
  const [resource, setResource] = useState<TradeKey>("food");
  const [direction, setDirection] = useState<"sell" | "buy">("sell");
  const maximum = useMemo(() => {
    const volume = Math.floor(market.left);
    if (direction === "sell") return Math.max(0, Math.min(volume, Math.floor(game.resources[resource])));
    const stockLimit = Math.min(volume, maxPurchase(market.commons[resource] ?? 0));
    let low = 0, high = stockLimit;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const preview = fillOrder(resource, middle, market.commons[resource] ?? 0, market.reference[resource] ?? 1, "buy", 0, market.index[resource] ?? 1);
      if (preview.gold <= game.resources.gold) low = middle; else high = middle - 1;
    }
    return low;
  }, [direction, game.resources, market.commons, market.index, market.left, market.reference, resource]);
  const [amount, setAmount] = useState(500);
  const effectiveAmount = Math.min(maximum, Math.max(0, amount));
  const preview = effectiveAmount > 0 ? fillOrder(resource, effectiveAmount, market.commons[resource] ?? 0, market.reference[resource] ?? 1, direction, direction === "sell" ? market.glut[resource] ?? 0 : 0, market.index[resource] ?? 1) : null;
  const selectedLabel = rows.find(([key]) => key === resource)?.[1] ?? resource;
  const moodEffect = livingCostMood(market.livingCost);

  return <div className={embedded ? "market-workspace embedded" : "market-workspace"} role={embedded ? undefined : "dialog"} aria-modal={embedded ? undefined : "true"} aria-label="Pazar çalışma alanı">
    <header className="workspace-head"><div><span>KRALLIK İÇİ TİCARET</span><h2>Pazar Sv.{market.level}</h2><p>Fiyatı halkın elindeki miktar belirler; büyük işlemlerde fiyat işlem sırasında değişir.</p></div><button onClick={onClose}>SAHNEYE DÖN ✕</button></header>
    {!market.level ? <div className="workspace-empty"><h3>Pazar henüz kurulmadı</h3><p>Kale Sv.2 olduğunda Pazar yapısını kurup halkla kaynak alışverişi yapabilirsiniz.</p><button onClick={onClose}>KAPAT</button></div> : <div className="market-workspace-grid">
      <section className="market-comparison"><div className="workspace-section-title"><span>KARŞILAŞTIRMA TABLOSU</span><b>{market.left} / {market.limit} HACİM KALDI</b></div>
        <div className="market-table-head"><span>Mal</span><span>Fiyat</span><span>Halkta</span><span>Ambarda</span><span>Durum</span></div>
        {rows.map(([key, label]) => { const coverage = market.coverage[key] ?? 1; return <button key={key} className={resource === key ? "market-table-row selected" : "market-table-row"} onClick={() => setResource(key)}><b>{label}</b><strong>{(market.price[key] ?? 0).toFixed(2)} altın</strong><span>{Math.round(market.commons[key] ?? 0)}</span><span>{Math.floor(game.resources[key])}</span><em className={coverage < .6 ? "scarce" : coverage > 1.5 ? "abundant" : "balanced"}>{coverage < .6 ? "Kıt" : coverage > 1.5 ? "Bol" : "Dengeli"}</em><i><u style={{ width: `${Math.max(3, Math.min(100, coverage * 50))}%` }}/></i></button>; })}
        <div className={moodEffect < 0 ? "market-context danger" : moodEffect > 0 ? "market-context relief" : "market-context"}><span>HALKIN GEÇİM YÜKÜ</span><b>{market.livingCost > 1.25 ? "Pahalı" : market.livingCost < .85 ? "Ucuz" : "Normal"}</b><p>{moodEffect === 0 ? "Rızaya etkisi yok." : `Halkın rızasına ${moodEffect > 0 ? "+" : ""}${Math.round(moodEffect)} puan etkisi var.`}</p></div>
        {market.open.length > 0 && <div className="market-orders"><span>BEKLEYEN İŞLEMLER</span>{market.open.map(order => <article key={order.id}><div><b>{order.direction === "sell" ? "Satış" : "Alış"} · {order.amount} {rows.find(([key]) => key === order.resource)?.[1]?.toLocaleLowerCase("tr-TR") ?? order.resource}</b><small>{order.gold} altın · {formatLeft(order.completesAt)}</small></div><i><u style={{ width: `${Math.max(3, Math.min(100, (now - order.placedAt) / (order.completesAt - order.placedAt) * 100))}%` }}/></i></article>)}</div>}
      </section>
      <aside className="market-transaction"><span>İŞLEM PANELİ</span><h3>{selectedLabel}</h3><p>Seçtiğiniz miktarın ortalama ve son fiyatını emir vermeden önce görün.</p>
        <div className="trade-direction"><button className={direction === "sell" ? "active" : ""} onClick={() => setDirection("sell")}>AMBARDAN SAT</button><button className={direction === "buy" ? "active" : ""} onClick={() => setDirection("buy")}>HALKTAN AL</button></div>
        <label>MİKTAR <input type="number" min={0} max={maximum} value={effectiveAmount} onChange={event => setAmount(Math.min(maximum, Math.max(0, Number(event.target.value) || 0)))}/></label>
        <input className="trade-range" type="range" min={0} max={Math.max(1, maximum)} value={effectiveAmount} onChange={event => setAmount(Number(event.target.value))}/>
        <div className="quick-amounts"><button onClick={() => setAmount(Math.floor(maximum * .25))}>%25</button><button onClick={() => setAmount(Math.floor(maximum * .5))}>%50</button><button onClick={() => setAmount(maximum)}>TÜMÜ</button></div>
        <dl><div><dt>İşlem sınırı</dt><dd>{maximum} birim</dd></div><div><dt>{direction === "sell" ? "Beklenen gelir" : "Ödenecek"}</dt><dd>{preview?.gold ?? 0} altın</dd></div><div><dt>Ortalama fiyat</dt><dd>{preview?.average.toFixed(3) ?? "—"}</dd></div><div><dt>Fiyat hareketi</dt><dd>{preview ? `${preview.from.toFixed(2)} → ${preview.to.toFixed(2)}` : "—"}</dd></div></dl>
        {(market.glutted || market.indexed) && <div className="market-warning">{market.glutted ? "Tezgâhlardaki olağandışı bolluk satış gelirini azaltıyor. " : ""}{market.indexed ? "Channel pazar endeksi fiyatı etkiliyor." : ""}</div>}
        <button className="trade-submit" disabled={connecting || effectiveAmount < 1 || market.freeSlots < 1} onClick={() => { onSubmit(direction === "sell" ? `Pazarda ${effectiveAmount} ${selectedLabel.toLocaleLowerCase("tr-TR")} sat.` : `Pazardan ${effectiveAmount} ${selectedLabel.toLocaleLowerCase("tr-TR")} satın al.`); onClose(); }}>{market.freeSlots < 1 ? "İŞLEM YUVASI DOLU" : direction === "sell" ? "GENERALE SATIŞI İLET" : "GENERALE ALIŞI İLET"}</button>
        <small>{market.freeSlots}/{market.slots} işlem yuvası boş · Alış satıştan {Math.round((market.spread - 1) * 100)}% pahalıdır.</small>
      </aside>
    </div>}
  </div>;
}
