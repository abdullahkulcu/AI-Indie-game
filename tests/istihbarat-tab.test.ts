/**
 * İSTİHBARAT SEKMESİNİN TAŞIMA TESTİ.
 *
 * `components/KingdomGame.tsx` içindeki JSX çalıştırılarak test edilemiyor (bu
 * kod tabanında hiç DOM/render testi yok, bkz. package.json → test listesi).
 * Taşımanın gerçek riski de mantık değil MUHASEBE: bir panel taşınırken
 * kaybolabilir, eski yerinde KOPYA kalabilir ya da düğmesi çağırdığı
 * fonksiyondan kopabilir. Bu test tam olarak onu denetler — kaynak metnini
 * sekme bloklarına bölüp her panelin TEK bir blokta durduğunu doğrular.
 *
 * Kırılganlığı bilinçli: paneli bir yerden bir yere taşıyan gelecek bir
 * değişiklik bu testi güncellemek ZORUNDA kalır, yani taşıma sessizce olmaz.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/KingdomGame.tsx", import.meta.url), "utf8");
const sceneSource = readFileSync(new URL("../components/KingdomScene.tsx", import.meta.url), "utf8");
const mapSource = readFileSync(new URL("../components/ChannelWorldMap.tsx", import.meta.url), "utf8");
const marketSource = readFileSync(new URL("../components/MarketWorkspace.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

/** Sekme bloğu: `{tab==="x"` işaretinden bir sonraki sekme işaretine kadar. */
function tabBlock(tab: string) {
  const marks = [...source.matchAll(/\{tab==="/g)].map(match => match.index ?? 0);
  const start = source.indexOf(`{tab==="${tab}"`);
  assert.notEqual(start, -1, `${tab} sekmesi kaynakta yok`);
  const next = marks.find(index => index > start);
  return source.slice(start, next ?? source.length);
}

const occurrences = (needle: string) => source.split(needle).length - 1;

test("dört ana bölüm mockuptaki çalışma sayfalarını ve Sefer Masasını bağlamsal olarak açıyor", () => {
  assert.match(source, /type Tab="meclis"\|"general"\|"defter"\|"binalar"\|"halk"\|"pazar"\|"ordu"\|"sefer"\|"istihbarat"\|"diyar"\|"iliskiler"\|"muzakere"/);
  assert.match(source, /className="royal-navigation"/);
  assert.match(source, /id:"divan"/);
  assert.match(source, /id:"krallik"/);
  assert.match(source, /id:"savas"/);
  assert.match(source, /id:"diyar"/);
  assert.equal(occurrences('className="tabs seven"'), 0, "eski yedi sekmelik şerit kullanımda kalmamalı");
  assert.ok(source.includes("[panelOpen,setPanelOpen]=useState(false)"), "karar katmanı sahneyi varsayılan olarak kapatmamalı");
  assert.ok(source.includes('{panelOpen&&<aside className="council-panel">'), "karar katmanı açılır/kapanır olmalı");
  assert.ok(source.includes("← SAHNEYE DÖN"), "katmanda açık bir sahneye dönüş eylemi olmalı");
  assert.ok(source.includes("if(active)setPanelOpen(false)"), "aktif mühüre yeniden basmak katmanı kapatmalı");
  for (const tab of ["meclis", "general", "defter", "binalar", "halk", "pazar", "ordu", "istihbarat", "diyar", "iliskiler", "muzakere"]) {
    assert.ok(source.includes(`{tab==="${tab}"`), `${tab} sekmesinin içeriği yok`);
  }
  for (const marker of ['label:"Meclis"', 'label:"General"', 'label:"Defter"', 'label:"Binalar"', 'label:"Halk"', 'label:"Pazar"', 'label:"Ordu"', 'label:"Sefer Masası"', 'label:"Dolaylı Mücadele"', 'label:"Harita"', 'label:"İlişkiler"', 'label:"Müzakere"']) {
    assert.ok(source.includes(marker), `ana bölümde ${marker} sayfası bağlanmamış`);
  }
});

test("Sefer Masası General taslağını gösterir ama savaş mührünü Krala bırakır", () => {
  const campaign = readFileSync(new URL("../components/WarCampaignWorkspace.tsx", import.meta.url), "utf8");
  assert.ok(campaign.includes("GENERAL TASLAĞI"));
  assert.ok(campaign.includes("SEFER MÜHRÜNÜ VUR"));
  assert.ok(campaign.includes("HURUÇ YAP"));
  assert.ok(campaign.includes("BARIŞ BELGESİ HAZIRLA"));
  assert.ok(source.includes('{tab==="sefer"&&<div className="campaign-panel">'), "Sefer Masası karar katmanının içinde açılmalı");
  assert.ok(!source.includes('if(tab==="sefer")return'), "Sefer Masası ana sahneden ayrı bir sayfaya geçmemeli");
});

test("binalar ekranı son tasarımdaki üretim panosu ve kompakt yapı kartlarını kullanıyor", () => {
  const buildings = tabBlock("binalar");
  assert.ok(buildings.includes('className="build-layout"'), "iki kolonlu bina yerleşimi yok");
  assert.ok(buildings.includes('className="chain-board"'), "üretim zinciri panosu yok");
  assert.ok(buildings.includes('className="building-list"'), "kompakt bina kartları yok");
  assert.ok(buildings.includes("Üretim zinciri neden-sonuç ilişkisini gösterir"), "tasarımın açıklayıcı başlığı yok");
  assert.ok(buildings.includes("GENERALE İLET"), "bina kararının General'e iletilme eylemi yok");
  assert.ok(buildings.includes("buildOptions(game)"), "kart maliyetleri gerçek motor seçeneklerinden gelmiyor");
  assert.ok(buildings.includes("rt?.food") && buildings.includes("rt?.wood") && buildings.includes("rt?.iron"),
    "üretim zinciri canlı kaynak hızlarını göstermiyor");
  assert.ok(!buildings.includes('className="keep-card"') && !buildings.includes('className="build-action"'),
    "eski uzun bina listesi kullanımda kalmamalı");
});

test("karşı-istihbarat paneli İSTİHBARAT'a taşındı ve diyar'da kopyası kalmadı", () => {
  const intel = tabBlock("istihbarat");
  assert.ok(intel.includes("KARŞI-İSTİHBARAT"), "panel taşınmamış");
  // Düğmenin çağırdığı fonksiyon hâlâ bağlı olmalı; işlev kaybı tam burada olur.
  assert.ok(intel.includes('worldAction("defend")'), "nöbet kurma çağrısı koptu");
  assert.ok(intel.includes("incomingAlerts"), "tespit edilen ajan sayacı kayboldu");
  assert.equal(occurrences("KARŞI-İSTİHBARAT"), 1, "panelin kopyası kalmış");
  assert.equal(occurrences('worldAction("defend")'), 2, "savunma hem hızlı nöbette hem operasyon planında bağlı olmalı");
  assert.ok(!tabBlock("diyar").includes("KARŞI-İSTİHBARAT"));
});

test("casus ağı planlı kart değil, kalıcı rapor akışına bağlı bir istihbarat operasyonudur", () => {
  const intel = tabBlock("istihbarat");
  assert.ok(intel.includes('setSelectedOperation("spy_network")'), "casus ağı seçilebilir olmalı");
  assert.ok(source.includes('worldAction("spy_network",targetId)'), "ağ emri dünya API'sine bağlı olmalı");
  assert.ok(source.includes('import { SPY_NETWORK } from "@/engine/intelligence"'), "maliyet motorun tek kaynağından okunmalı");
  assert.ok(!intel.includes("Kalıcı ajan ağı mevcut oyun motorunda henüz uygulanmıyor."));
});

test("gelen dolaylı faaliyetler kapatılamıyor; savunmanın sonuçları açıklanıyor", () => {
  const intel = tabBlock("istihbarat");
  assert.ok(intel.includes("GELEN DOLAYLI FAALİYETLER"));
  assert.ok(intel.includes("etkiyi azalt") && intel.includes("göndereni açığa çıkar") && intel.includes("misilleme fırsatı"),
    "karşı-istihbarat sonuçları açıklanmıyor");
  assert.ok(intel.includes("agitation.sentToday") && intel.includes("agitation.cost"),
    "günlük tavan ve kese bedeli göstergesi kayboldu");
  assert.equal(occurrences("GELEN DOLAYLI FAALİYETLER"), 1, "panelin kopyası kalmış");
  assert.equal(occurrences("setAgitationOpt("), 0, "kapatma davranışı kaynakta kalmamalı");
  assert.ok(!source.includes("HATTI KAPAT") && !source.includes("HATTI AÇ"));
});

test("haydut yönlendirme İSTİHBARAT'ta okunuyor, ordu sekmesinde kopyası yok", () => {
  const intel = tabBlock("istihbarat");
  assert.ok(intel.includes("HAYDUT YÖNLENDİRME"));
  assert.ok(intel.includes("lureAt(game,now)"), "yönlendirme payı motordan okunmuyor");
  assert.equal(occurrences("lureAt(game,now)"), 1, "yönlendirme iki yerde okunuyor");
  assert.ok(!tabBlock("ordu").includes("lureAt("));
  // Akın defteri (püskürtülen/yarılan) askeri okuma olduğu için Ordu'da KALDI.
  assert.ok(tabBlock("ordu").includes("raid-tally"));
});

test("zafer skoru İSTİHBARAT'ta ve hesabı motordan geliyor", () => {
  const intel = tabBlock("istihbarat");
  assert.ok(intel.includes("victoryScore({"), "skor panelde hesaplanmıyor olmalı ama motordan çağrılmalı");
  assert.match(source, /import \{ victoryScore, type VictoryPurse \} from "@\/engine\/victory"/);
  // Panel hiçbir katsayıyı elle yazmasın: satır etiketleri ve puanlar motordan.
  assert.equal(occurrences("victoryScore("), 1);
  assert.ok(intel.includes("score.doctrine.label") && intel.includes("score.quiet") && intel.includes("score.martial"),
    "iki sütun ve doktrin etiketi panelde görünmüyor");
  assert.ok(intel.includes("DOLAYLI MÜCADELE") && intel.includes("DOLAYLI ÜSTÜNLÜK"),
    "oyuncuya gösterilen adlandırma dolaylı mücadele olmalı");
  assert.ok(!intel.includes("ASKERSİZ SAVAŞ") && !intel.includes("ASKERSİZ ÜSTÜNLÜK"));
});

test("muhalefet paneli HALK sekmesinde kaldı: muhalefet kendi halkımıza dairdir", () => {
  const people = tabBlock("halk");
  assert.ok(people.includes("İÇ MUHALEFET"), "muhalefet paneli halk sekmesinden kaybolmuş");
  assert.ok(people.includes("factionPressureOf(game)"), "muhalefet baskısı okuması koptu");
  assert.ok(!tabBlock("istihbarat").includes("İÇ MUHALEFET"),
    "muhalefet İSTİHBARAT'a taşınmamalı: bu sekme komşuya, muhalefet kendi halkımıza bakar");
  assert.equal(occurrences("<span>İÇ MUHALEFET</span>"), 1, "panelin kopyası kalmış");
});

test("diyar sayfaları harita, ilişkiler ve müzakere işlevlerini ayrı çalışma alanlarına taşıdı", () => {
  const realm = tabBlock("diyar");
  assert.ok(realm.includes("<ChannelWorldMap") && realm.includes("embedded"), "Diyar haritası sayfa içine gömülmemiş");
  assert.ok(realm.includes('onScout={id=>void worldAction("scout",id)}'), "haritanın bilgi toplama eylemi kopmuş");
  assert.ok(tabBlock("iliskiler").includes('className="relations-grid"'), "ilişki kartları ayrı sayfada yok");
  const negotiation = tabBlock("muzakere");
  assert.ok(negotiation.includes('className="treaty-document"'), "anlaşma belgesi yok");
  assert.ok(negotiation.includes('className="envoy-correspondence"'), "elçi yazışmaları yok");
});

test("mockuptaki sayfa içerikleri yalnız kabuk değil gerçek bilgi alanlarıyla eşleşiyor", () => {
  const court = tabBlock("meclis");
  for (const marker of ['className="decision-document"', 'className="ai-council-grid"', 'className="council-history-preview"', 'className="call-council"', 'DİVANI TOPLA', "SON ÜÇ DİVAN TOPLANTISI", "HALK MECLİSİ", "GARNİZON", "KOMUTA GÖRÜŞÜ", "ÜÇ BAĞIMSIZ GÖRÜŞ"]) {
    assert.ok(court.includes(marker), `Divan içeriğinden ${marker} eksik`);
  }

  const councilLedger = tabBlock("defter");
  assert.ok(councilLedger.includes('className="council-ledger"'), "Divan kayıtları Defter'e bağlanmamış");

  const people = tabBlock("halk");
  for (const marker of ['className="people-overview"', 'className="social-groups"', 'className="people-issues"']) {
    assert.ok(people.includes(marker), `Halk içeriğinden ${marker} eksik`);
  }

  const army = tabBlock("ordu");
  for (const marker of ['className="readiness-card"', 'className="unit-roster"', '"unit-card"', 'className="campaign-card"', "Garnizon planı"]) {
    assert.ok(army.includes(marker), `Ordu içeriğinden ${marker} eksik`);
  }

  assert.ok(source.includes("<WarCampaignWorkspace"), "Sefer Masası oyun kabuğuna bağlanmamış");
  const campaignSource = readFileSync(new URL("../components/WarCampaignWorkspace.tsx", import.meta.url), "utf8");
  for (const marker of ["SEFER MASASI", "SEFERİ HESAPLA", "SEFER MÜHRÜNÜ VUR", "HURUÇ YAP", "BARIŞ ŞARTI SUN", "BARIŞ BELGESİ HAZIRLA"]) {
    assert.ok(campaignSource.includes(marker), `Sefer içeriğinden ${marker} eksik`);
  }

  const indirect = tabBlock("istihbarat");
  for (const marker of ['className="indirect-tabs"', 'className="operation-grid"', 'className="operation-builder"', "Propaganda", "Diplomatik baskı", "Halk hareketlerini destekleme", "Karşı istihbarat"]) {
    assert.ok(indirect.includes(marker), `Dolaylı Mücadele içeriğinden ${marker} eksik`);
  }
  assert.ok(indirect.includes("1 · Operasyon") && indirect.includes("2 · Hedef") && indirect.includes("3 · Yöntem ve kaynak") && indirect.includes("4 · General"));

  const ledger = tabBlock("defter");
  assert.ok(ledger.includes('className="ledger-filters"') && ledger.includes('className="ledger-timeline"'), "Defter kronoloji ve filtre içermiyor");
  assert.ok(tabBlock("pazar").includes("<MarketWorkspace") && tabBlock("pazar").includes("embedded"), "Pazar karşılaştırma alanı sayfa içine gömülmemiş");
});

test("yerel sahnedeki binalar hem üç boyutlu gövdeden hem etiketten seçilebiliyor", () => {
  assert.ok(sceneSource.includes("onBuildingSelect?:"), "sahne seçim sözleşmesi yok");
  assert.ok(sceneSource.includes('group.userData.buildingType=slot.item.type'), "bina gövdelerine seçim kimliği yazılmıyor");
  assert.ok(sceneSource.includes("new THREE.Raycaster()"), "üç boyutlu bina tıklaması için raycaster yok");
  assert.ok(sceneSource.includes('"world-label building-label"'), "bina etiketi etkileşimli değil");
  assert.ok(source.includes('className="scene-building-card"'), "seçilen binanın küçük bilgi kartı yok");
  assert.ok(source.includes("YAPI KARARLARINI AÇ"), "bina kartından karar ekranına geçiş yok");
});

test("diyar haritası karar için istihbarat, zayıflık ve diplomasi bağlamını gösteriyor", () => {
  for (const marker of ["İSTİHBARAT SEVİYESİ", "BİLİNEN ZAYIFLIKLAR", "DİPLOMATİK DURUM", "BİLGİ TOPLA", "MÜZAKERE AÇ"]) {
    assert.ok(mapSource.includes(marker), `harita ayrıntısından ${marker} eksik`);
  }
  assert.ok(mapSource.includes("RAPOR ÇIKARIMI"), "zayıflıkların doğrulanmış rapordan çıkarım olduğu açıklanmıyor");
  assert.ok(source.includes("onNegotiate={id=>"), "haritadaki müzakere eylemi elçiliğe bağlanmamış");
});

test("pazar karşılaştırma tablosu ve iki yönlü işlem paneli kullanıyor", () => {
  for (const marker of ["KARŞILAŞTIRMA TABLOSU", "İŞLEM PANELİ", "AMBARDAN SAT", "HALKTAN AL", "Fiyat hareketi"]) {
    assert.ok(marketSource.includes(marker), `yeni pazar alanından ${marker} eksik`);
  }
  assert.ok(marketSource.includes("maxPurchase("), "halktan alış sınırı motor kuralından okunmuyor");
  assert.ok(marketSource.includes("fillOrder("), "işlem önizlemesi fiyat kaymasını hesaplamıyor");
});

test("müzakere çalışma alanı masa seçimi, belge ve yazışmayı birlikte sunuyor", () => {
  assert.ok(source.includes('className="negotiation-table-tabs"'), "masa seçici yok");
  assert.ok(source.includes("DİPLOMASİ ÇALIŞMA ALANI"), "müzakere çalışma alanı başlığı yok");
  assert.ok(styles.includes('content:"ELÇİ YAZIŞMALARI"'), "elçi yazışma alanı görsel olarak ayrılmamış");
  assert.ok(styles.includes(".envoy-terms::after"), "anlaşma belgesinin mühür bağlamı yok");
});

test("harita etiketleri karar katmanlarının üzerine çıkmıyor", () => {
  assert.ok(styles.includes(".world-label{z-index:2}"));
  assert.ok(styles.includes(".council-panel{z-index:40}"));
  assert.ok(styles.includes(".market-workspace{position:absolute;z-index:65"));
});

test("derin gözetleme ayrı, pahalı ve riskli istihbarat görevi olarak sunulur", () => {
  const intel = tabBlock("istihbarat");
  assert.ok(intel.includes("Derin gözetleme"), "derin görev istihbarat sekmesinde görünmüyor");
  assert.ok(intel.includes('worldAction("deep_observation",operationTarget)'), "derin görev doğru sunucu emrine bağlı değil");
  assert.ok(intel.includes("100 altın · iki kat süre"), "bedel ve süre oyuncuya açıklanmıyor");
  assert.ok(mapSource.includes("DERİN GÖZETLEME · 100 ALTIN"), "diyar haritasında doğrudan görev eylemi yok");
});
