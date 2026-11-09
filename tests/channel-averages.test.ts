import assert from "node:assert/strict";
import test from "node:test";
import { COMPARE_MIN_SAMPLE, compareVerdict } from "../engine/comparison";
import { channelAverages } from "../server/world-projection";

/**
 * CHANNEL KIYASININ SINIRLARI.
 *
 * Ortalama anonimdir ama anonimliğin bedava olmadığı üç yer var ve üçü de
 * burada ölçülür: kuruluş koruması süren krallık ortalamaya girmez, Kralın
 * kendisi girmez, ve aday sayısı gizlilik alt sınırının altındaysa SAYI HİÇ
 * ÜRETİLMEZ (iki sancağın ortalaması, kendi değerini bilen bir Kral için
 * rakibin değerini birebir çözer).
 */

const NOW = 1_800_000_000_000;

/** Şemayı (`gameSaveSchema`) tam tutan en küçük geçerli kayıt. */
function save(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 2, kingdomName: "Sancak", rulerName: "Kral", channel: "Sınır Boyu", speed: 1, terrain: "plain",
    foundedAt: NOW - 10 * 86_400_000, lastTickAt: NOW, protectionEndsAt: NOW - 5 * 86_400_000,
    resources: { gold: 100, food: 100, wood: 10, stone: 10, iron: 0, ale: 0 },
    population: 60, capacity: 80, popularity: 60, reputation: 50, loyalty: 50, taxRate: 20,
    buildings: [{ type: "keep", name: "Kale", category: "yönetim", level: 1 }], units: {}, queue: null, notices: [],
    provider: null, model: null, generalConnected: false,
    ...overrides,
  });
}

const rows = (entries: Array<{ userId: string; gameState: string }>) => entries;

test("ortalama elle doğrulanmış küçük örnekte doğru hesaplanır", () => {
  const result = channelAverages({
    channelName: "Sınır Boyu", excludeUserId: "kral", now: NOW,
    rows: rows([
      { userId: "a", gameState: save({ popularity: 60, foodRation: 100, taxRate: 10, factionPressure: 0 }) },
      { userId: "b", gameState: save({ popularity: 30, foodRation: 70, taxRate: 20, factionPressure: 30 }) },
      { userId: "c", gameState: save({ popularity: 90, foodRation: 130, taxRate: 30, factionPressure: 60 }) },
    ]),
  });
  assert.equal(result.counted, 3);
  assert.equal(result.protectedOut, 0);
  assert.deepEqual(result.averages, { popularity: 60, foodRation: 100, taxRate: 20, factionPressure: 30 });
});

test("istihkak ve muhalefet baskısı kayıtta yoksa motorun varsayılanı sayılır", () => {
  // Eski kayıtlarda bu iki alan hiç yoktur. Varsayılan burada değil motorda
  // yaşar (`rationsOf` → 100, `factionPressureOf` → 0); ortalama bizim
  // satırımızla aynı ölçekte kalmak zorunda.
  const result = channelAverages({
    channelName: "Sınır Boyu", excludeUserId: null, now: NOW,
    rows: rows([
      { userId: "a", gameState: save({ popularity: 50, taxRate: 10 }) },
      { userId: "b", gameState: save({ popularity: 50, taxRate: 10 }) },
      { userId: "c", gameState: save({ popularity: 50, taxRate: 10 }) },
    ]),
  });
  assert.deepEqual(result.averages, { popularity: 50, foodRation: 100, taxRate: 10, factionPressure: 0 });
});

test("kuruluş koruması süren krallık ortalamaya girmez", () => {
  // Dış kese ve göç sistemlerindeki aynı kural: korumadaki krallık henüz
  // gerçek rekabetin içinde değil, kıyasa da katılmaz.
  const result = channelAverages({
    channelName: "Sınır Boyu", excludeUserId: null, now: NOW,
    rows: rows([
      { userId: "a", gameState: save({ popularity: 30 }) },
      { userId: "b", gameState: save({ popularity: 30 }) },
      { userId: "c", gameState: save({ popularity: 30 }) },
      { userId: "yeni", gameState: save({ popularity: 99, protectionEndsAt: NOW + 3_600_000 }) },
    ]),
  });
  assert.equal(result.counted, 3);
  assert.equal(result.protectedOut, 1);
  assert.equal(result.averages?.popularity, 30, "korumadaki krallığın 99 rızası ortalamayı yukarı çekmemeli");
});

test("Kralın kendi krallığı ortalamaya girmez ve koruma sayacına yazılmaz", () => {
  const result = channelAverages({
    channelName: "Sınır Boyu", excludeUserId: "kral", now: NOW,
    rows: rows([
      { userId: "kral", gameState: save({ popularity: 100, protectionEndsAt: NOW + 3_600_000 }) },
      { userId: "a", gameState: save({ popularity: 40 }) },
      { userId: "b", gameState: save({ popularity: 40 }) },
      { userId: "c", gameState: save({ popularity: 40 }) },
    ]),
  });
  assert.equal(result.counted, 3);
  // Kralın kendi koruma durumu "hariç tutulan komşu" sayısına yazılsaydı, o
  // sayı Krala komşular hakkında yanlış bilgi verirdi.
  assert.equal(result.protectedOut, 0);
  assert.equal(result.averages?.popularity, 40);
});

test("bozuk, şemayı tutmayan ya da başka channel'a ait kayıt ortalamayı bozmaz", () => {
  const result = channelAverages({
    channelName: "Sınır Boyu", excludeUserId: null, now: NOW,
    rows: rows([
      { userId: "a", gameState: save({ popularity: 20 }) },
      { userId: "b", gameState: save({ popularity: 20 }) },
      { userId: "c", gameState: save({ popularity: 20 }) },
      { userId: "bozuk", gameState: "bu json değil" },
      { userId: "sema-dışı", gameState: save({ popularity: 9999 }) },
      { userId: "uzak", gameState: save({ popularity: 100, channel: "Başka Dünya" }) },
    ]),
  });
  assert.equal(result.counted, 3, "okunamayan üç kayıt sessizce atlanmalı");
  assert.equal(result.averages?.popularity, 20);
});

test("aday sayısı gizlilik alt sınırının altındaysa sayı hiç üretilmez", () => {
  const two = channelAverages({
    channelName: "Sınır Boyu", excludeUserId: null, now: NOW,
    rows: rows([
      { userId: "a", gameState: save({ popularity: 10 }) },
      { userId: "b", gameState: save({ popularity: 90 }) },
    ]),
  });
  assert.equal(two.counted, 2);
  assert.equal(two.averages, null, "iki sancağın ortalaması rakibin defterini ele verir");
  // Eşik tam sınırda açılır: alt sınır kadar aday yeterlidir.
  const enough = channelAverages({
    channelName: "Sınır Boyu", excludeUserId: null, now: NOW,
    rows: rows(Array.from({ length: COMPARE_MIN_SAMPLE }, (_unused, index) => ({ userId: `k${index}`, gameState: save({ popularity: 50 }) }))),
  });
  assert.equal(enough.counted, COMPARE_MIN_SAMPLE);
  assert.equal(enough.averages?.popularity, 50);
});

test("boş channel'da ortalama yok ama hesap patlamaz", () => {
  const result = channelAverages({ channelName: "Sınır Boyu", excludeUserId: "kral", now: NOW, rows: [] });
  // `market` de `averages` ile aynı kapıdan geçer (Fikir 24): aday yoksa
  // pazar endeksinin girdisi de üretilmez.
  assert.deepEqual(result, { counted: 0, protectedOut: 0, averages: null, market: null });
});

/**
 * YÖN: her ölçütte "iyi" aynı tarafta değil. Yüksek rıza ve yüksek istihkak
 * iyidir, yüksek vergi ve yüksek muhalefet baskısı KÖTÜDÜR. Arayüz satır başına
 * elle karar vermesin diye yön tek yerde (`engine/comparison.ts`) yaşıyor.
 */
test("kıyas yönü ölçüte göre değişir", () => {
  assert.equal(compareVerdict("popularity", 70, 50), "better");
  assert.equal(compareVerdict("foodRation", 80, 100), "worse");
  assert.equal(compareVerdict("taxRate", 30, 20), "worse");
  assert.equal(compareVerdict("factionPressure", 5, 40), "better");
  assert.equal(compareVerdict("taxRate", 20, 20), "even");
});
