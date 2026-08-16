"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

const KingdomScene = dynamic(() => import("@/components/KingdomScene"), { ssr: false });

const resources = [
  ["ALTIN", "2.340", "+82/sa"], ["YİYECEK", "890", "+124/sa"],
  ["TAŞ", "410", "+42/sa"], ["ODUN", "260", "+58/sa"],
  ["DEMİR", "75", "−18/sa"], ["BİRA", "40", "+12/sa"],
];
const buildings = [
  ["Ekonomi", "Buğday Tarlası", "Sv.3", "Üretiyor · 100/sa"], ["Ekonomi", "Değirmen", "Sv.2", "Darboğaz · 60/sa"],
  ["Ekonomi", "Fırın", "Sv.2", "Üretiyor · Ekmek"], ["Ekonomi", "Maden", "Sv.2", "Rezerv · %64"],
  ["Ekonomi", "Dökümhane", "Sv.1", "Üretiyor · Demir"], ["Ekonomi", "Pazar", "Sv.1", "3 açık teklif"],
  ["Askerî", "Kışla", "Sv.2", "12 Mızrakçı · 1sa 20dk"], ["Askerî", "Okçu Meydanı", "Sv.1", "Hazır"],
  ["Askerî", "Sur", "Sv.2", "Bütünlük · %100"], ["Yönetim", "Kale", "Sv.3→4", "2sa 14dk kaldı"],
  ["Yönetim", "Meydan", "Sv.1", "Nüfus · 340/420"], ["Yönetim", "Kilise", "Sv.1", "+4 halkın rızası"],
];
const reports = [
  ["TEHDİT", "Karataş ordusu sınırınıza yaklaşıyor.", "3 saat sonra"], ["KERVAN", "Kızılorman’dan 200 demir yola çıktı.", "12 dk önce"],
  ["BÖLGE", "Yeşilvadi, Taşyürek ile çatışmaya girdi.", "40 dk önce"], ["KORUMA", "Yeni oyuncu korumanız yakında sona eriyor.", "41 saat kaldı"],
];
type Tab = "meclis" | "binalar" | "defter" | "diyar";

export default function Home() {
  const [tab, setTab] = useState<Tab>("meclis");
  const [night, setNight] = useState(false);
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState([{ who: "Başvezir Aldric", text: "Efendimiz, demir açığımız büyüyor. Maden ocağını derinleştirebilir ya da Kızılorman pazarından alabiliriz. Ticaret, yaklaşan kuşatma öncesinde daha güvenli görünüyor." }]);
  const [pending, setPending] = useState(true);
  const seasonProgress = useMemo(() => Math.round((34 / 84) * 100), []);
  function sendMessage(event: React.FormEvent) {
    event.preventDefault(); if (!message.trim()) return; const command = message.trim();
    setChat((items) => [...items, { who: "Kral", text: command }, { who: "Başvezir Aldric", text: "Buyruğunuzu değerlendirdim. Bu karar 1 emir harcar; kaynak ve güvenlik önkoşullarını doğruladıktan sonra uygulama kaydına geçireceğim." }]); setMessage("");
  }
  return <main className={night ? "app-shell night" : "app-shell"}>
    <header className="topbar"><div className="brand-mark" aria-hidden="true">♜</div><div className="title-block"><h1>DEMİRKALE</h1><p>KRALLIK SİMÜLASYONU</p></div><div className="channel-chip"><span>● CANLI</span><b>SEZON II · GÜN 34</b><small>%{seasonProgress} tamamlandı</small></div><button className="day-toggle" onClick={() => setNight((v) => !v)} aria-label="Gündüz veya gece görünümünü değiştir">{night ? "☾ GECE" : "☀ GÜNDÜZ"}</button><button className="profile-button">Kral Alaric <span>⌄</span></button></header>
    <section className="resource-ribbon" aria-label="Krallık kaynakları">{resources.map(([name, value, rate]) => <div className="resource" key={name}><span>{name}</span><strong>{value}</strong><small className={rate.startsWith("−") ? "negative" : ""}>{rate}</small></div>)}<div className="population"><span>HALKIN RIZASI</span><strong>68</strong><div className="meter"><i style={{ width: "68%" }} /></div><small>340 / 420 nüfus</small></div></section>
    <section className="world-stage"><KingdomScene night={night} /><div className="scene-title"><span>BAŞKENT</span><h2>Demirkale Krallığı</h2><p>Sürükle: döndür · Tekerlek: yakınlaş · Uzaklaş: diyar ağı</p></div><div className="map-legend"><span><i className="trade" /> Ticaret</span><span><i className="war" /> Düşmanlık</span></div>
      <aside className="council-panel"><div className="general-bars">{["Sadakat|82", "Emir Kotası|2/3", "İtibar|74"].map((item) => { const [label, value] = item.split("|"); const width = value.includes("/") ? 66 : Number(value); return <div className="stat" key={label}><span>{label}</span><div><i style={{ width: `${width}%` }} /></div><b>{value}</b></div>; })}</div>
        <nav className="tabs" aria-label="Krallık yönetimi">{(["meclis", "binalar", "defter", "diyar"] as Tab[]).map((name) => <button key={name} className={tab === name ? "active" : ""} onClick={() => setTab(name)}>{name.toLocaleUpperCase("tr")}</button>)}</nav>
        <div className="panel-content">
          {tab === "meclis" && <div className="council-content"><div className="advisor"><div className="portrait">A</div><div><h3>Başvezir Aldric</h3><p>Saray Generaliniz · BYOK bağlı</p></div><span className="online">●</span></div>{pending && <div className="decision"><span>BÜYÜK KARAR · ONAY BEKLİYOR</span><h4>Karataş sınırına takviye</h4><p>60 okçuyu doğu garnizonuna kaydırmak başkenti geçici olarak zayıflatır.</p><div><button onClick={() => setPending(false)}>ONAYLA</button><button onClick={() => setPending(false)}>REDDET</button></div></div>}<div className="chat-log">{chat.map((item, index) => <div className={item.who === "Kral" ? "message king" : "message"} key={`${item.who}-${index}`}><b>{item.who}</b><p>{item.text}</p></div>)}</div><form className="chat-form" onSubmit={sendMessage}><input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Generalinize buyruğunuzu iletin…" aria-label="Generalinize mesaj"/><button aria-label="Buyruğu gönder">✦</button></form></div>}
          {tab === "binalar" && <div className="list-content"><div className="section-head"><span>23 YAPI</span><b>1 kuyrukta</b></div>{buildings.map(([category, name, level, detail]) => <div className="building-row" key={name}><span className="building-icon">◆</span><div><small>{category}</small><h4>{name}</h4><p className={detail.includes("Darboğaz") ? "warn" : ""}>{detail}</p></div><b>{level}</b></div>)}</div>}
          {tab === "defter" && <div className="ledger"><div className="section-head"><span>HAZİNE DEFTERİ</span><b>Son tick: şimdi</b></div>{resources.map(([name, value, rate]) => <div key={name}><span>{name}</span><strong>{value}</strong><small className={rate.startsWith("−") ? "negative" : ""}>{rate}</small></div>)}<hr/><p>Vergi oranı <b>%18</b></p><p>Ambar doluluğu <b>%82</b></p><p>Maden rezervi <b>51.200 / 80.000</b></p></div>}
          {tab === "diyar" && <div className="realm"><div className="section-head"><span>BÖLGESEL DUYUM</span><b>6 saatlik özet</b></div><div className="mini-map"><i className="you">D</i><i className="ally a">K</i><i className="enemy e">T</i><i className="ally b">Y</i><i className="enemy c">E</i></div>{reports.map(([kind, report, time]) => <div className="report" key={report}><span>{kind}</span><p>{report}<small>{time}</small></p></div>)}</div>}
        </div>
      </aside>
    </section>
  </main>;
}
