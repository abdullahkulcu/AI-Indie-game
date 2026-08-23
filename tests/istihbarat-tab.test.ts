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

/** Sekme bloğu: `{tab==="x"` işaretinden bir sonraki sekme işaretine kadar. */
function tabBlock(tab: string) {
  const marks = [...source.matchAll(/\{tab==="/g)].map(match => match.index ?? 0);
  const start = source.indexOf(`{tab==="${tab}"`);
  assert.notEqual(start, -1, `${tab} sekmesi kaynakta yok`);
  const next = marks.find(index => index > start);
  return source.slice(start, next ?? source.length);
}

const occurrences = (needle: string) => source.split(needle).length - 1;

test("sekme tipi ve şeridi yedi sekmeyi tanıyor", () => {
  assert.match(source, /type Tab="meclis"\|"binalar"\|"halk"\|"ordu"\|"istihbarat"\|"defter"\|"diyar"/);
  assert.match(source, /className="tabs seven"/);
  assert.equal(occurrences('"tabs six"'), 0, "eski altı sekmelik şerit sınıfı kullanımda kalmamalı");
  for (const tab of ["meclis", "binalar", "halk", "ordu", "istihbarat", "defter", "diyar"]) {
    assert.ok(source.includes(`{tab==="${tab}"`), `${tab} sekmesinin içeriği yok`);
  }
});

test("karşı-istihbarat paneli İSTİHBARAT'a taşındı ve diyar'da kopyası kalmadı", () => {
  const intel = tabBlock("istihbarat");
  assert.ok(intel.includes("KARŞI-İSTİHBARAT"), "panel taşınmamış");
  // Düğmenin çağırdığı fonksiyon hâlâ bağlı olmalı; işlev kaybı tam burada olur.
  assert.ok(intel.includes('worldAction("defend")'), "nöbet kurma çağrısı koptu");
  assert.ok(intel.includes("incomingAlerts"), "tespit edilen ajan sayacı kayboldu");
  assert.equal(occurrences("KARŞI-İSTİHBARAT"), 1, "panelin kopyası kalmış");
  assert.equal(occurrences('worldAction("defend")'), 1);
  assert.ok(!tabBlock("diyar").includes("KARŞI-İSTİHBARAT"));
});

test("dış kese paneli İSTİHBARAT'a taşındı ve hat açma/kapama çağrısı bağlı", () => {
  const intel = tabBlock("istihbarat");
  assert.ok(intel.includes("DIŞ KESE"));
  assert.ok(intel.includes("setAgitationOpt(!agitation.accepts)"), "hattı açma/kapama çağrısı koptu");
  assert.ok(intel.includes("agitation.sentToday") && intel.includes("agitation.cost"),
    "günlük tavan ve kese bedeli göstergesi kayboldu");
  assert.equal(occurrences("DIŞ KESE"), 1, "panelin kopyası kalmış");
  assert.ok(!tabBlock("diyar").includes("setAgitationOpt("));
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
});

test("muhalefet paneli HALK sekmesinde kaldı: muhalefet kendi halkımıza dairdir", () => {
  const people = tabBlock("halk");
  assert.ok(people.includes("İÇ MUHALEFET"), "muhalefet paneli halk sekmesinden kaybolmuş");
  assert.ok(people.includes("factionPressureOf(game)"), "muhalefet baskısı okuması koptu");
  assert.ok(!tabBlock("istihbarat").includes("İÇ MUHALEFET"),
    "muhalefet İSTİHBARAT'a taşınmamalı: bu sekme komşuya, muhalefet kendi halkımıza bakar");
  assert.equal(occurrences("<span>İÇ MUHALEFET</span>"), 1, "panelin kopyası kalmış");
});

test("diyar sekmesi kendi işlevlerini korudu", () => {
  const realm = tabBlock("diyar");
  for (const marker of ["CHANNEL KIYASI", "AYNI CHANNEL", 'worldAction("scout"', "shared-mine", "BAŞKENT ARAZİSİ"]) {
    assert.ok(realm.includes(marker), `diyar sekmesinden ${marker} kaybolmuş`);
  }
});
