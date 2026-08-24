import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MAX_STEP_HOURS, capacityFor, servedRations, tick } from "../engine/tick";
import { moodState, populationChange } from "../engine/populace";
import { validateGameSave } from "../server/save-validation";
import type { Game } from "../engine/types";

/**
 * NÜFUS HESABININ ADIM BORCU — KALICI REGRESYON TESTİ.
 *
 * Kısıt #2: istemci saniyede bir `tick()` atar, sunucu tek çağrıda atar; ikisi
 * aynı `now` için AYNI sonucu üretmek zorundadır. Üretmezse sunucu meşru kaydı
 * reddeder ve oyuncu ilerlemesini kaybeder.
 *
 * Nüfus bu kuralın son ihlal edildiği yerdi ve iki ayrı borcu vardı:
 *
 *  1. `populationChange` oransal bir süreci DOĞRUSAL yazıyordu
 *     (`P × oran × saat`). Böyle bir biçimde toplam, sürenin kaç adıma
 *     bölündüğüne bağlıdır. Kapalı çözümle (kayıpta üstel, büyümede lojistik)
 *     düzeltildi.
 *  2. Nüfus oranı rızanın KESİKLİ bandından okunuyor ve rıza da hedefe doğru
 *     yürüyen bir gecikme süzgeci. 24 saatlik bir adımda süzgeç 120 puan
 *     yürüyebildiği için rıza hedefe SIÇRIYOR, bir band atlanıyor ve büyüme
 *     tamamen donabiliyordu. Adım `MAX_STEP_HOURS` = 1 oyun saatine indirildi.
 *
 * Aşağıdaki iddialar ikisini birlikte koruyor. BİRİ BOZULURSA oyuncular yeniden
 * ilerleme kaybetmeye başlar — bu dosyayı zayıflatmak yerine sebebini bulun.
 */

const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;

const content = moodState(80, 0);   // Memnun: büyüme
const revolt = moodState(5, 0);     // İsyan: kayıp
const simmering = moodState(30, 0); // Kaynıyor: oran sıfır

const buildings = [
  { type: "keep", name: "Kale", category: "Yönetim", level: 2 },
  { type: "wheat_farm", name: "Buğday Tarlası", category: "Ekonomi", level: 3 },
  { type: "lumberjack", name: "Oduncu Kulübesi", category: "Ekonomi", level: 2 },
  { type: "town_square", name: "Meydan", category: "Yönetim", level: 3 },
];

function newGame(overrides: Partial<Game> = {}): Game {
  return {
    version: 2, kingdomName: "Demirkale", rulerName: "Alaric", channel: "Test", channelId: "c1",
    speed: 1, terrain: "plain", foundedAt: T0 - 10 * 86_400_000, lastTickAt: T0,
    protectionEndsAt: T0 - 6 * 86_400_000,
    resources: { gold: 800, food: 900, stone: 300, wood: 300, iron: 120, ale: 150 },
    population: 100, capacity: 400, popularity: 60, reputation: 50, loyalty: 75,
    taxRate: 10, quota: 6, quotaAt: T0,
    buildings, units: { spearman: 0 }, queue: null, notices: [],
    provider: null, model: null, generalConnected: false,
    ...overrides,
  };
}

/** Aynı toplam süreyi n eşit adıma bölerek uygular. */
function stepped(state: typeof content, population: number, capacity: number, hours: number, steps: number) {
  let current = population;
  for (let i = 0; i < steps; i += 1) current += populationChange(state, current, capacity, buildings, hours / steps);
  return current;
}

// --- 1. Saf katman: kapalı çözüm gerçekten bölünebilir mi ------------------

test("KAYIP kapalı çözümü bölünebilir: 24 saat = 24 × 1 saat = 1440 × 1 dakika", () => {
  const tek = 200 + populationChange(revolt, 200, 400, buildings, 24);
  assert.ok(Math.abs(tek - stepped(revolt, 200, 400, 24, 24)) < 1e-9, "saatlik bölünme sapmamalı");
  assert.ok(Math.abs(tek - stepped(revolt, 200, 400, 24, 1440)) < 1e-9, "dakikalık bölünme sapmamalı");
});

test("BÜYÜME kapalı çözümü bölünebilir: lojistik akış tek parametreli bir grup", () => {
  const tek = 100 + populationChange(content, 100, 400, buildings, 24);
  assert.ok(Math.abs(tek - stepped(content, 100, 400, 24, 24)) < 1e-9, "saatlik bölünme sapmamalı");
  assert.ok(Math.abs(tek - stepped(content, 100, 400, 24, 1440)) < 1e-9, "dakikalık bölünme sapmamalı");
});

test("DOĞRUSAL biçim bölünebilir DEĞİLDİ — testin gerçekten ayırt ettiğini gösterir", () => {
  // Eski biçim buydu. Aynı 24 saat, tek adımda ve 24 adımda farklı sayı verir;
  // yukarıdaki iddiaların 1e-9 toleransı bu farkı ayırt edecek kadar dar mı?
  const rate = revolt.populationRate;
  const dogrusalTek = 200 * (1 + rate * 24);
  let dogrusalBolunmus = 200;
  for (let i = 0; i < 24; i += 1) dogrusalBolunmus += dogrusalBolunmus * rate;
  assert.ok(Math.abs(dogrusalTek - dogrusalBolunmus) > 1, "doğrusal biçimin sapması gözle görülür olmalı");
});

test("uzun kayıpta nüfus eksiye düşmez (doğrusal biçim düşüyordu)", () => {
  // İsyan oranı saatte −%3; doğrusal biçimde 34 saatte nüfus eksiye geçerdi.
  const after = 200 + populationChange(revolt, 200, 400, buildings, 400);
  assert.ok(after > 0, `üstel erime sıfırın altına inmemeli, ölçülen: ${after}`);
  assert.ok(after < 1, "yine de neredeyse hiç kimse kalmamalı");
});

test("büyüme kapasiteyi hiçbir sürede aşmaz", () => {
  for (const hours of [1, 24, 240, 2400]) {
    const after = 100 + populationChange(content, 100, 400, buildings, hours);
    assert.ok(after <= 400 + 1e-9, `${hours} saatte kapasite aşıldı: ${after}`);
  }
});

test("kapasitesi dolmuş, kapasitesiz ve durgun bandda değişim sıfır", () => {
  assert.equal(populationChange(content, 400, 400, buildings, 24), 0, "dolu krallık büyümez");
  assert.equal(populationChange(content, 450, 400, buildings, 24), 0, "aşmış krallık da büyümez");
  assert.equal(populationChange(content, 100, 0, buildings, 24), 0, "kapasitesi yok");
  assert.equal(populationChange(simmering, 100, 400, buildings, 24), 0, "Kaynıyor bandı durgun");
  assert.equal(populationChange(content, 0, 400, buildings, 24), 0, "kimse yoksa değişim yok");
  assert.equal(populationChange(content, 100, 400, buildings, 0), 0, "süre yoksa değişim yok");
});

// --- 2. Motor katmanı: iki tarafın kaydı buluşuyor mu ---------------------

/** Sekmesi açık kalan istemci: saniyelik adımlarla sürenin tamamı. */
function openTab(game: Game, until: number) {
  let current = game;
  for (let t = game.lastTickAt + 1000; t <= until; t += 1000) current = tick(current, t);
  return current;
}

test("SUNUCU İLE İSTEMCİ AYNI KAYDA VARIR: kayıt her tempoda kabul edilir", () => {
  // Bu, bütün işin ölçütü. Düzeltmelerden önce sağdaki üç satır 409 alıyordu
  // (sırasıyla %80, %114 ve %163 sapma).
  for (const [speed, hours] of [[1, 30], [1, 72], [1, 168], [4, 24], [24, 2], [24, 6]] as const) {
    const previous = newGame({ speed });
    const saveAt = T0 + hours * HOUR;
    const client = openTab(previous, saveAt);
    const result = validateGameSave(client as never, {
      previous: previous as never, previousUpdatedAt: T0, channelSpeed: speed, now: saveAt,
    });
    assert.equal(result.ok, true,
      `×${speed} tempo, ${hours} saat: ${result.ok ? "" : result.error}`);
  }
});

test("nüfus sapması dilim sınırının ALTINDA yalnızca yuvarlama kadardır", () => {
  // Bir dilimden kısa aralıkta iki taraf da aynı kapalı çözümü uygular; kalan
  // tek fark kayan nokta toplamının son bitleri. Normal kayıt aralığı (5
  // saniye) bu banda düşer, yani günlük oyunda sapma diye bir şey yok.
  // Tolerans 1e-9 GÖRECELİ: doğrusal biçimin aynı aralıktaki sapması bunun
  // milyonlarca katıydı, yani bu iddia gerçekten ayırt ediyor.
  for (const [speed, seconds] of [[1, 5], [4, 60], [24, 120]] as const) {
    const previous = newGame({ speed });
    const saveAt = T0 + seconds * 1000;
    const client = openTab(previous, saveAt);
    const server = tick(previous, saveAt);
    const relative = Math.abs(client.population / server.population - 1);
    assert.ok(relative < 1e-9,
      `×${speed}, ${seconds} sn: istemci ${client.population}, sunucu ${server.population}`);
  }
});

test("nüfus, kapasite ve taban kırpmaları adım bölünmesinden bağımsız", () => {
  // Aç ve isyan hâlindeki krallık tabana (20) iner; hem tek çağrı hem saniyelik
  // adımlar aynı tabana oturmalı.
  const previous = newGame({ population: 60, popularity: 0, foodRation: 0, taxRate: 60,
    resources: { gold: 0, food: 0, stone: 0, wood: 0, iron: 0, ale: 0 } });
  const saveAt = T0 + 96 * HOUR;
  assert.equal(openTab(previous, saveAt).population, tick(previous, saveAt).population);
});

test("kapasite tek doğru kaynaktan okunur", () => {
  // Kayıttaki `capacity` alanı değil `capacityFor(buildings)` geçerli.
  const yanlisKapasite = newGame({ capacity: 9999 });
  assert.equal(tick(yanlisKapasite, T0 + HOUR).capacity, capacityFor(buildings));
});

/** Kıtlık: stok az, üretim talebin altında. Pencere integrali burada ayrışır. */
const scarce = newGame({
  population: 300, popularity: 55, units: { spearman: 40 },
  resources: { gold: 50, food: 30, stone: 10, wood: 10, iron: 5, ale: 0 },
  buildings: [
    { type: "keep", name: "Kale", category: "Yönetim", level: 1 },
    { type: "wheat_farm", name: "Buğday Tarlası", category: "Ekonomi", level: 1 },
  ],
});

test("motorun okuduğu istihkak, panelin okuduğu ile AYNI pencereden gelir", () => {
  // `satisfaction` bir PENCERE İNTEGRALİDİR: aynı kıt krallıkta 24 saatlik
  // pencere maaş payını %62, bir saatlik pencere %100 gösterir. Motor adımın
  // boyunu pencere olarak kullanırsa "tokluk" adım bölünmesine bağlı olur —
  // kısıt #2 ihlali — ve panel (`components/KingdomGame.tsx`) ile halkın sesi
  // (`engine/populace-voice.ts`) zaten varsayılan bir saatlik pencereyi
  // okuduğu için oyuncuya gösterilen rakamdan da sapar.
  assert.notEqual(servedRations(scarce, 24).pay, servedRations(scarce).pay,
    "senaryo pencereye gerçekten duyarlı olmalı, yoksa aşağıdaki iddia boş kalır");
  const source = readFileSync(new URL("../engine/tick.ts", import.meta.url), "utf8");
  assert.ok(!/servedRations\(g,\s*hours\)/.test(source),
    "tick istihkak oranını adımın boyuna göre hesaplamamalı");
});

// --- 3. Sınırın kendisi ---------------------------------------------------

test("dilim bir oyun saatidir: rızanın gecikme süzgeci bir adımda taşamaz", () => {
  // Sayı büyütülürse rıza bir adımda hedefe sıçrar, band atlanır ve nüfus
  // donabilir. Ölçüm: 2 saat %2.8, 6 saat %12.1, 24 saat %49.8 sapma.
  assert.equal(MAX_STEP_HOURS, 1);
});

test("motor saf kalır: nüfus hesabında zar, Date.now ve crypto yok", () => {
  for (const file of ["engine/populace.ts", "engine/tick.ts"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const forbidden of ["Math.random", "Date.now", "crypto.getRandomValues", "crypto.randomUUID"]) {
      assert.ok(!source.includes(forbidden), `${file} içinde ${forbidden} olmamalı`);
    }
  }
});
