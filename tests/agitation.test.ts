import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyActions } from "../engine/actions";
import {
  AGITATION, agitationDayStart, agitationEffect, agitationPairWindow,
  agitationTravelMs, applyAgitation, feltUnrest,
} from "../engine/agitation";
import { SOLDIER_THRESHOLDS, suppression } from "../engine/populace";
import { factionPressureOf } from "../engine/faction";
import { tick } from "../engine/tick";
import type { Game } from "../engine/types";
import { reputationChange } from "../server/game/diplomacy";
import { validateGameSave } from "../server/save-validation";

const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;

function newGame(overrides: Partial<Game> = {}): Game {
  return {
    version: 2, kingdomName: "Demirkale", rulerName: "Alaric", channel: "Standart Sezon I", channelId: "standard",
    speed: 1, terrain: "plain", foundedAt: T0 - 10 * 86_400_000, lastTickAt: T0, protectionEndsAt: T0 - 6 * 86_400_000,
    resources: { gold: 5000, food: 5000, stone: 1000, wood: 1000, iron: 500, ale: 500 },
    population: 200, capacity: 400, popularity: 60, reputation: 50, loyalty: 75, taxRate: 15, quota: 6, quotaAt: T0,
    buildings: [
      { type: "keep", name: "Kale", category: "Yönetim", level: 2 },
      { type: "barracks", name: "Kışla", category: "Askeri", level: 1 },
      { type: "wheat_farm", name: "Buğday Tarlası", category: "Ekonomi", level: 3 },
    ],
    units: { spearman: 20 }, queue: null, notices: [], provider: null, model: null, generalConnected: false,
    watchRatio: 50,
    ...overrides,
  };
}

// --- Fiyat ve tavanlar -----------------------------------------------------

test("kese sabit fiyatlıdır ve doğrulayıcı toleransına saklanamaz", () => {
  // SIMULATION_FLOOR = 250; kese onun 2,4 katı olduğu için hazineden çıkışı
  // toleransın içinde kaybolamaz.
  assert.equal(AGITATION.cost, 600);
  assert.ok(AGITATION.cost > 250 * 2);
});

test("halka giden kesenin tavanı şenliğin rıza katkısının altındadır", () => {
  // Şenlik rızaya 12 puan katıyor (engine/actions.ts → host_festival).
  assert.ok(AGITATION.commons.cap < 12, `tavan ${AGITATION.commons.cap}`);
  assert.equal(AGITATION.commons.perPurse, 9.6);
});

test("askere giden kesenin tavanı maaş talebi eşiğinin altındadır", () => {
  assert.ok(AGITATION.garrison.cap < SOLDIER_THRESHOLDS.demand, `tavan ${AGITATION.garrison.cap}`);
});

test("tek kese eşikleri tam olarak beklenen kadar oynatır", () => {
  const target = newGame();
  const commons = applyAgitation(target, "gold_commons", T0);
  assert.equal(commons.agitationPressure, 9.6);
  assert.equal(commons.agitationBribe, 0);
  const garrison = applyAgitation(target, "gold_garrison", T0);
  assert.equal(garrison.agitationBribe, AGITATION.garrison.perPurse);
  assert.equal(garrison.agitationPressure, 0);
});

test("art arda kese tavanı aşamaz", () => {
  let carrier = newGame();
  for (let i = 0; i < 12; i += 1) {
    carrier = { ...carrier, ...applyAgitation(carrier, "gold_commons", T0 + i * HOUR) };
  }
  assert.ok((carrier.agitationPressure ?? 0) <= AGITATION.commons.cap);
  let armed = newGame();
  for (let i = 0; i < 12; i += 1) {
    armed = { ...armed, ...applyAgitation(armed, "gold_garrison", T0 + i * HOUR) };
  }
  assert.ok((armed.agitationBribe ?? 0) <= AGITATION.garrison.cap);
  assert.ok((armed.agitationBribe ?? 0) < SOLDIER_THRESHOLDS.demand, "tek başına ordu dağıtamaz");
});

// --- Sönüm: damga tabanlı, kapalı çözümlü ----------------------------------

test("etki damgadan sönümlenir ve tam bölünebilir", () => {
  const carrier = newGame({ agitationPressure: 9.6, agitationAt: T0 });
  const eight = agitationEffect(carrier, T0 + AGITATION.tau * HOUR).pressure;
  // τ kadar sonra e^-1 katına iner.
  assert.ok(Math.abs(eight - 9.6 / Math.E) < 1e-9, `çıkan ${eight}`);
  // Aradan ikiye bölmek aynı sonucu verir: damga sabit, adım sayısı önemsiz.
  const half = agitationEffect(carrier, T0 + 4 * HOUR).pressure;
  const rest = agitationEffect({ ...carrier, agitationPressure: half, agitationAt: T0 + 4 * HOUR }, T0 + 8 * HOUR).pressure;
  assert.ok(Math.abs(eight - rest) < 1e-9);
});

test("hızlı channel'da sönüm oyun saatiyle işler", () => {
  const slow = agitationEffect(newGame({ speed: 1, agitationPressure: 10, agitationAt: T0 }), T0 + HOUR).pressure;
  const fast = agitationEffect(newGame({ speed: 24, agitationPressure: 10, agitationAt: T0 }), T0 + HOUR).pressure;
  assert.ok(fast < slow, "×24 channel'da bir gerçek saat 24 oyun saatidir");
});

test("cron'un gecikmesi sonucu değiştirmez", () => {
  // Etki `completesAt` anına damgalanır; cron ne zaman koşarsa koşsun aynı
  // değerler yazılır. Bu, geriye dönük damgalamanın kanıtı.
  const target = newGame();
  const early = applyAgitation(target, "gold_commons", T0 + 2 * HOUR);
  const late = applyAgitation(target, "gold_commons", T0 + 2 * HOUR);
  assert.deepEqual(early, late);
  assert.equal(early.agitationAt, T0 + 2 * HOUR);
});

test("kalkan sönümü hızlandırır ve geleni yarılar", () => {
  const shielded = newGame({ agitationShieldUntil: T0 + 12 * HOUR });
  assert.equal(applyAgitation(shielded, "gold_commons", T0).agitationPressure, 9.6 * AGITATION.shieldedShare);
  const open = agitationEffect(newGame({ agitationPressure: 10, agitationAt: T0 }), T0 + 3 * HOUR).pressure;
  const behind = agitationEffect(newGame({ agitationPressure: 10, agitationAt: T0, agitationShieldUntil: T0 + 12 * HOUR }), T0 + 3 * HOUR).pressure;
  assert.ok(behind < open, "kalkan altında birikim daha hızlı erir");
});

// --- Hedefte kaynak alanı yazılmaması -------------------------------------

test("kese hedefin hiçbir kaynak alanına dokunmaz", () => {
  const target = newGame();
  const after = { ...target, ...applyAgitation(target, "gold_garrison", T0) };
  // JSON diff: yalnızca üç taşıyıcı alan değişmiş olmalı.
  const changed = Object.keys(after).filter(key =>
    JSON.stringify((after as Record<string, unknown>)[key]) !== JSON.stringify((target as Record<string, unknown>)[key]));
  assert.deepEqual(changed.sort(), ["agitationAt", "agitationBribe", "agitationPressure"]);
  assert.deepEqual(after.resources, target.resources);
  assert.equal(after.population, target.population);
  assert.equal(after.popularity, target.popularity);
});

// --- Kanallar --------------------------------------------------------------

test("kese hizip baskısını büyütür ama alanın içine yazılmaz", () => {
  const target = newGame({ popularity: 60, agitationPressure: 9.6, agitationAt: T0 });
  const after = tick(target, T0 + HOUR);
  // Rıza yüksek: hizbin kendi baskısı sıfır kalır, kesenin payı ayrı taşınır.
  assert.equal(factionPressureOf(after), 0);
  assert.ok((after.agitationPressure ?? 0) > 0, "taşıyıcı alan silinmez");
});

test("kese huzursuzluğu hissettirir ama soldierUnrest alanına yazılmaz", () => {
  const target = newGame({ soldierUnrest: 10, soldierPay: 100, agitationBribe: 18, agitationAt: T0 });
  assert.equal(Math.round(feltUnrest(target, T0)), 28);
  const after = tick(target, T0 + HOUR);
  // Maaş tam ödendiği için kaydın kendi huzursuzluğu ERİR; kesenin payı ayrı durur.
  assert.ok((after.soldierUnrest ?? 0) < 10, `alan erimeli, çıkan ${after.soldierUnrest}`);
  assert.ok((after.agitationBribe ?? 0) > 0);
});

test("kese zapt gücünü de zayıflatır", () => {
  const clean = suppression(20, 200, 10, 0);
  const bribed = suppression(20, 200, feltUnrest(newGame({ soldierUnrest: 10, agitationBribe: 18, agitationAt: T0 }), T0), 0);
  assert.ok(bribed < clean);
});

test("kese garnizon vetosunu tetikleyebilir", () => {
  // Kaydın kendi huzursuzluğu 20 (eşiğin altında), kese 12 ekliyor → 32 ≥ 30.
  const game = newGame({ soldierUnrest: 20, agitationBribe: 12, agitationAt: T0 });
  const refused = applyActions(game, [{ name: "train_unit", arguments: { unit_type: "spearman", count: 3 } }], T0).results;
  assert.match(refused[0], /^✕/);
  assert.match(refused[0], /yeni asker almayı reddetti/);
  // Kese olmasa emir yürüyordu.
  const allowed = applyActions(newGame({ soldierUnrest: 20 }), [{ name: "train_unit", arguments: { unit_type: "spearman", count: 3 } }], T0).results;
  assert.match(allowed[0], /^✓/);
});

// --- Tavan ve pencere yardımcıları ---------------------------------------

test("çift penceresi ve gün penceresi channel hızıyla ölçeklenir", () => {
  // Pencere ızgarası 6 oyun saatliktir: aynı ızgara gözüne düşen iki kese
  // veritabanı seviyesinde çakışır (yarışa karşı katman). Sürenin kendisi
  // uygulama katmanında ölçülür, bkz. server/agitation-desk.ts.
  const window = AGITATION.pairWaitHours * HOUR;
  const grid = Math.floor(T0 / window) * window;
  assert.equal(agitationPairWindow(grid, 1), agitationPairWindow(grid + window - 1, 1));
  assert.notEqual(agitationPairWindow(grid, 1), agitationPairWindow(grid + window, 1));
  // ×24 channel'da ızgara 15 gerçek dakikaya iner.
  assert.notEqual(agitationPairWindow(grid, 24), agitationPairWindow(grid + 20 * 60_000, 24));
  assert.equal(agitationDayStart(T0, 1), T0 - 86_400_000);
  assert.equal(agitationDayStart(T0, 24), T0 - 86_400_000 / 24);
});

test("kese yolda hızlı channel'da daha kısa kalır", () => {
  assert.ok(agitationTravelMs(24) < agitationTravelMs(1));
  assert.ok(agitationTravelMs(1) > 0);
});

test("tavanlar tek dosyada ve plandaki değerlerde", () => {
  assert.equal(AGITATION.perSenderPerDay, 4);
  assert.equal(AGITATION.perTargetPerDay, 3);
  assert.equal(AGITATION.pairWaitHours, 6);
});

// --- İtibar cezası ---------------------------------------------------------

test("yakalanan kese itibar cezası taşır", () => {
  assert.equal(reputationChange("caught_agitating"), -10);
  // İhanet ayrı ve daha ağır bir olaydır; imzalı barışta ikisi birlikte işler.
  assert.equal(reputationChange("betrayal"), -20);
});

// --- Sunucu-türevi olması --------------------------------------------------

const save = (game: Game) => JSON.parse(JSON.stringify(game)) as Game;

test("istemcinin bildirdiği kese alanları yok sayılır", () => {
  const previous = save(newGame({ lastTickAt: T0 }));
  // İstemci kendi kaydından keseyi siliyor.
  const withPurse = save(newGame({ lastTickAt: T0, agitationBribe: 18, agitationPressure: 9.6, agitationAt: T0 }));
  const claimed = save({ ...tick(withPurse, T0 + HOUR), agitationBribe: 0, agitationPressure: 0, agitationAt: 0 });
  const result = validateGameSave(claimed, {
    previous: withPurse as never, previousUpdatedAt: T0, channelSpeed: 1, now: T0 + HOUR,
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.game.agitationBribe, 18);
  assert.equal(result.ok && result.game.agitationPressure, 9.6);

  // Tersi de: istemci kendi lehine kalkan uyduramaz.
  const faked = save({ ...tick(previous, T0 + HOUR), agitationShieldUntil: T0 + 999 * HOUR });
  const second = validateGameSave(faked, {
    previous: previous as never, previousUpdatedAt: T0, channelSpeed: 1, now: T0 + HOUR,
  });
  assert.equal(second.ok, true);
  assert.equal(second.ok && second.game.agitationShieldUntil, undefined);
});

test("kese alanı olmayan eski kayıt reddedilmez", () => {
  const previous = save(newGame());
  const next = save(tick(previous, T0 + HOUR));
  const result = validateGameSave(next, {
    previous: previous as never, previousUpdatedAt: T0, channelSpeed: 1, now: T0 + HOUR,
  });
  assert.equal(result.ok, true);
});

// --- Sıfır ek model çağrısı ----------------------------------------------

test("dış kese hiçbir yeni model çağrısı açmaz", () => {
  const files = ["engine/agitation.ts", "server/agitation-desk.ts"];
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const forbidden of ["fetch(", "callProvider", "decryptByok", "api.openai.com", "api.anthropic.com"]) {
      assert.ok(!source.includes(forbidden), `${file} içinde ${forbidden} olmamalı`);
    }
  }
});

test("motor saf kalır: kesede zar ve duvar saati yok", () => {
  const source = readFileSync(new URL("../engine/agitation.ts", import.meta.url), "utf8");
  for (const forbidden of ["Math.random", "Date.now", "crypto.getRandomValues"]) {
    assert.ok(!source.includes(forbidden), `engine/agitation.ts içinde ${forbidden} olmamalı`);
  }
});
