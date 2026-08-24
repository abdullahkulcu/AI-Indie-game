import assert from "node:assert/strict";
import test from "node:test";
import {
  FACTION_THRESHOLDS, advanceFaction, factionDrag, factionLeaderName,
  factionNotice, factionPressureOf, factionState, factionTarget,
} from "../engine/faction";
import { suppression } from "../engine/populace";
import { tick } from "../engine/tick";
import type { Game } from "../engine/types";
import { validateGameSave } from "../server/save-validation";

const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;

function newGame(overrides: Partial<Game> = {}): Game {
  return {
    version: 2, kingdomName: "Demirkale", rulerName: "Alaric", channel: "Standart Sezon I", channelId: "standard",
    speed: 1, terrain: "plain", foundedAt: T0, lastTickAt: T0, protectionEndsAt: T0 + 4 * 86_400_000,
    resources: { gold: 5000, food: 5000, stone: 1000, wood: 1000, iron: 500, ale: 500 },
    population: 100, capacity: 300, popularity: 50, reputation: 50, loyalty: 75, taxRate: 15, quota: 6, quotaAt: T0,
    buildings: [
      { type: "keep", name: "Kale", category: "Yönetim", level: 1 },
      { type: "wheat_farm", name: "Buğday Tarlası", category: "Ekonomi", level: 2 },
    ],
    units: { spearman: 0 }, queue: null, notices: [], provider: null, model: null, generalConnected: false,
    ...overrides,
  };
}

// --- Hedef eğrisi ----------------------------------------------------------

test("iyi ve normal krallıkta muhalefet hedefi sıfırdır", () => {
  // Ölçülen dinlenme noktaları: normal krallık 42-46, iyi krallık 62-67.
  for (const mood of [42, 44, 46, 62, 65, 67, 100]) {
    assert.equal(factionTarget(mood), 0, `rıza ${mood}`);
  }
});

test("hedef rıza eşiğin altına indikçe büyür ve 100'de tavanlanır", () => {
  assert.equal(factionTarget(40), 0);
  assert.equal(factionTarget(39), 7.5);
  assert.equal(factionTarget(30), 75);
  assert.equal(factionTarget(20), 100, "tavan aşılmaz");
});

// --- Kabul kriteri: ölçülen zaman ölçeği -----------------------------------

test("rıza 24 saat 30'un altında kalırsa baskı 0'dan 60'ın üstüne çıkar", () => {
  assert.ok(advanceFaction(0, 30, 24) >= 60, `çıkan: ${advanceFaction(0, 30, 24)}`);
  assert.ok(advanceFaction(0, 25, 24) >= 60);
});

test("rıza 60'a dönünce 12 saatte baskı 20'nin altına iner", () => {
  assert.ok(advanceFaction(60, 60, 12) < 20, `çıkan: ${advanceFaction(60, 60, 12)}`);
});

// --- Adım bağımsızlığı (kapalı çözüm) --------------------------------------

test("birikim adımlara bölününce birebir aynı sonucu verir", () => {
  const single = advanceFaction(0, 25, 1);
  let stepped = 0;
  for (let i = 0; i < 3600; i += 1) stepped = advanceFaction(stepped, 25, 1 / 3600);
  assert.ok(Math.abs(single - stepped) < 1e-9, `tek adım ${single}, 3600 adım ${stepped}`);
});

test("erime de adımlara bölününce birebir aynı sonucu verir", () => {
  const single = advanceFaction(80, 70, 6);
  let stepped = 80;
  for (let i = 0; i < 6 * 3600; i += 1) stepped = advanceFaction(stepped, 70, 1 / 3600);
  assert.ok(Math.abs(single - stepped) < 1e-9, `tek adım ${single}, adımlı ${stepped}`);
});

test("sıfır ve eksi süre baskıyı değiştirmez", () => {
  assert.equal(advanceFaction(42, 10, 0), 42);
  assert.equal(advanceFaction(42, 10, -5), 42);
});

test("baskı 0-100 aralığını hiç terk etmez", () => {
  assert.equal(advanceFaction(0, 100, 999), 0);
  assert.ok(advanceFaction(100, 0, 999) <= 100);
  assert.equal(factionPressureOf({ factionPressure: 500 }), 100);
  assert.equal(factionPressureOf({ factionPressure: -20 }), 0);
  assert.equal(factionPressureOf({}), 0);
});

// --- Zapt gücünü zayıflatması ---------------------------------------------

test("muhalefet askerin zapt gücünü zayıflatır", () => {
  const clean = suppression(30, 100, 0, 0);
  assert.ok(clean > 0);
  assert.equal(suppression(30, 100, 0, 50), clean * 0.5);
  assert.equal(suppression(30, 100, 0, 100), 0, "tavan baskıda zapt gücü kalmaz");
  // Eski çağrılar (dördüncü parametre yok) aynı sonucu verir.
  assert.equal(suppression(30, 100, 0), clean);
});

test("çarpan tek yerde tanımlıdır", () => {
  assert.equal(factionDrag(0), 1);
  assert.equal(factionDrag(40), 0.6);
  assert.equal(factionDrag(100), 0);
});

// --- Elebaşı ve bildirim ---------------------------------------------------

test("elebaşının adı deterministiktir ve krallığa göre değişir", () => {
  assert.equal(factionLeaderName("Demirkale", T0), factionLeaderName("Demirkale", T0));
  assert.notEqual(factionLeaderName("Demirkale", T0), factionLeaderName("Akkale", T0));
  assert.match(factionLeaderName("Demirkale", T0), /^\S+ \S+$/);
});

test("bildirim yalnızca eşik geçişinde yazılır", () => {
  assert.equal(factionNotice(0, 10, "Demirkale", T0), null);
  assert.match(String(factionNotice(19, 21, "Demirkale", T0)), /fısıltı/);
  assert.match(String(factionNotice(49, 51, "Demirkale", T0)), new RegExp(factionLeaderName("Demirkale", T0)));
  assert.match(String(factionNotice(79, 81, "Demirkale", T0)), /rızasını yükselterek/);
  // Aynı eşik ikinci kez konuşmaz.
  assert.equal(factionNotice(55, 60, "Demirkale", T0), null);
});

test("muhalefet durumu eşiklere göre isimlendirilir", () => {
  assert.equal(factionState(0).id, "none");
  assert.equal(factionState(FACTION_THRESHOLDS.stirring).id, "stirring");
  assert.equal(factionState(FACTION_THRESHOLDS.organized).id, "organized");
  assert.equal(factionState(FACTION_THRESHOLDS.defiant).id, "defiant");
});

// --- Motorda ---------------------------------------------------------------

/**
 * BU TESTİN SENARYOSU DEĞİŞTİ. Önce `popularity: 20` ile başlayıp sekiz saat
 * ilerletiyordu, ama o krallığın hedef rızası ~50 olduğu için rıza sekiz saatte
 * yukarı TIRMANIYOR. Eski motor tek büyük adım attığından rızayı bir hamlede
 * hedefe sıçratıyor, arada geçen düşük-rıza süresini de tam sayıyor ve baskıyı
 * 42.88'e çıkarıp deftere "MUHALEFET" yazıyordu. Oyuncunun ekranında (saniyelik
 * adımlar) aynı senaryonun gerçek sonucu 9.99 ve HİÇ bildirim yoktu — yani test
 * kaba adımın uydurduğu bir muhalefet krizini doğruluyordu.
 *
 * Artık senaryo istihkakı sıfırlıyor: hedef rıza dibe oturduğu için rıza
 * hareket etmiyor ve baskı GERÇEKTEN büyüyor. Ölçüldü, bu senaryoda tek
 * dilimle saniyelik adımlar aynı sayıyı veriyor (42.88 = 42.88).
 */
test("tick baskıyı ilerletir ve eşik geçişini deftere yazar", () => {
  const game = newGame({ popularity: 20, foodRation: 0 });
  const after = tick(game, T0 + 8 * HOUR);
  assert.ok((after.factionPressure ?? 0) > FACTION_THRESHOLDS.stirring,
    `baskı eşiği geçmeli, ölçülen: ${after.factionPressure}`);
  assert.ok(after.notices.some(notice => notice.kind === "MUHALEFET"));
});

test("memnun krallıkta muhalefet hiç doğmaz", () => {
  const after = tick(newGame({ popularity: 75 }), T0 + 24 * HOUR);
  assert.equal(after.factionPressure, 0);
  assert.ok(!after.notices.some(notice => notice.kind === "MUHALEFET"));
});

test("tick'in adımları muhalefette de aynı sonucu verir", () => {
  // Rıza sabit tutulamıyor (tick onu da yürütüyor) ama sapma kıl payı kalmalı.
  const game = newGame({ popularity: 20, foodRation: 0 });
  const single = tick(game, T0 + 6 * HOUR);
  let stepped = game;
  for (let i = 0; i < 6; i += 1) stepped = tick(stepped, T0 + (i + 1) * HOUR);
  assert.ok(Math.abs((single.factionPressure ?? 0) - (stepped.factionPressure ?? 0)) < 2,
    `tek adım ${single.factionPressure}, altı adım ${stepped.factionPressure}`);
});

// --- Sunucu-türevi olması --------------------------------------------------

const save = (game: Game) => JSON.parse(JSON.stringify(game)) as Game;

test("istemcinin bildirdiği muhalefet baskısı yok sayılır", () => {
  // İstihkak sıfır: baskının gerçekten büyüdüğü senaryo (bkz. yukarıdaki not).
  const previous = save(newGame({ popularity: 20, foodRation: 0, lastTickAt: T0 }));
  // İstemci baskıyı sıfır bildirip cezadan kaçmaya çalışıyor.
  const claimed = save({ ...tick(previous, T0 + 12 * HOUR), factionPressure: 0 });
  const result = validateGameSave(claimed, {
    previous: previous as never, previousUpdatedAt: T0, channelSpeed: 1, now: T0 + 12 * HOUR,
  });
  assert.equal(result.ok, true);
  // İDDİA SUNUCUNUN KENDİ MOTORUNA BAĞLI, sabit bir sayıya değil: eşik sabit
  // yazılırsa motorun her ayarı bu testi kırar ve test kuralı değil sayıyı
  // korumuş olur. Asıl mesele istemcinin sıfırının yok sayılması.
  const own = tick(previous as never, T0 + 12 * HOUR).factionPressure ?? 0;
  assert.ok(own > 0, "senaryo gerçekten baskı üretmeli");
  assert.equal(result.ok && result.game.factionPressure, own,
    "sunucu kendi tick'inin değerini yazmalı");
});

test("istemci baskıyı şişiremez de", () => {
  const previous = save(newGame({ popularity: 75, lastTickAt: T0 }));
  const claimed = save({ ...tick(previous, T0 + HOUR), factionPressure: 100 });
  const result = validateGameSave(claimed, {
    previous: previous as never, previousUpdatedAt: T0, channelSpeed: 1, now: T0 + HOUR,
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.game.factionPressure, 0);
});

test("muhalefet alanı olmayan eski kayıt reddedilmez", () => {
  const previous = save(newGame());
  delete previous.factionPressure;
  const next = save(tick(previous, T0 + HOUR));
  delete next.factionPressure;
  const result = validateGameSave(next, {
    previous: previous as never, previousUpdatedAt: T0, channelSpeed: 1, now: T0 + HOUR,
  });
  assert.equal(result.ok, true);
});

test("ilk kayıtta muhalefet baskısı taşınmaz", () => {
  const first = save(newGame({ factionPressure: 90 }));
  const result = validateGameSave(first, { previous: null, previousUpdatedAt: null, channelSpeed: 1, now: T0 });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.game.factionPressure, undefined);
});
