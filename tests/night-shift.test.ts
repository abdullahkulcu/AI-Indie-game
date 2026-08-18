import assert from "node:assert/strict";
import test from "node:test";
import { WAKE_INTERVAL_MS, affordableOptions, compactContext, detectEmergency, rollDailyWindow, shouldWake, type StandingOrder } from "../server/night-shift";
import type { Game } from "../engine/types";

const T0 = 1_800_000_000_000;

function game(overrides: Partial<Game> = {}): Game {
  return {
    version: 2, kingdomName: "Demirkale", rulerName: "Alaric", channel: "Standart Sezon I", channelId: "standard",
    speed: 1, terrain: "plain", foundedAt: T0, lastTickAt: T0, protectionEndsAt: T0 + 4 * 86_400_000,
    resources: { gold: 1000, food: 500, stone: 300, wood: 300, iron: 100, ale: 0 },
    population: 100, capacity: 150, popularity: 50, reputation: 50, loyalty: 75, taxRate: 15, quota: 6, quotaAt: T0,
    buildings: [
      { type: "keep", name: "Kale", category: "Yönetim", level: 1 },
      { type: "wheat_farm", name: "Buğday Tarlası", category: "Ekonomi", level: 1 },
      { type: "lumberjack", name: "Oduncu Kulübesi", category: "Ekonomi", level: 1 },
    ],
    units: { spearman: 0 }, queue: null, notices: [], provider: null, model: null, generalConnected: true,
    ...overrides,
  };
}

function order(overrides: Partial<StandingOrder> = {}): StandingOrder {
  return {
    instruction: "Ekonomiyi büyüt, halkı aç bırakma.",
    autonomy: "autonomous",
    status: "active",
    maxActionsPerWake: 1,
    dailyActionCap: 8,
    actionsToday: 0,
    dayStartedAt: T0,
    lastRunAt: null,
    ...overrides,
  };
}

test("Kral onaylamadıysa General hiç uyanmaz", () => {
  const decision = shouldWake(order({ status: "pending_approval" }), game(), T0);
  assert.equal(decision.act, false);
  assert.match(decision.reason, /onaylamadı/);
});

test("duraklatılmış emirde uyanmaz", () => {
  assert.equal(shouldWake(order({ status: "paused" }), game(), T0).act, false);
});

test("aynı saatlik dilimde ikinci kez uyanmaz", () => {
  const recent = order({ lastRunAt: T0 - 10 * 60_000 });
  assert.equal(shouldWake(recent, game(), T0).act, false);
  assert.equal(shouldWake(order({ lastRunAt: T0 - WAKE_INTERVAL_MS - 1 }), game(), T0).act, true);
});

test("günlük tavan dolduğunda uyanmaz", () => {
  const spent = order({ actionsToday: 8, dailyActionCap: 8 });
  assert.equal(shouldWake(spent, game(), T0 + 3_600_000).act, false);
});

test("gün penceresi dolunca sayaç sıfırlanır", () => {
  const spent = order({ actionsToday: 8, dayStartedAt: T0 });
  assert.deepEqual(rollDailyWindow(spent, T0 + 25 * 3_600_000), { actionsToday: 0, dayStartedAt: T0 + 25 * 3_600_000 });
  assert.equal(rollDailyWindow(spent, T0 + 3_600_000).actionsToday, 8);
});

test("kuyruk doluyken model çağrılmaz", () => {
  const busy = game({ queue: { kind: "building", type: "quarry", name: "Taş Ocağı Sv.1", targetLevel: 1, startedAt: T0, completesAt: T0 + 9_000_000 } });
  const decision = shouldWake(order(), busy, T0);
  assert.equal(decision.act, false);
  assert.match(decision.reason, /Kuyruk dolu/);
});

test("kota sıfırken de gece vardiyası çalışır", () => {
  // Kota kaldırıldı; gece uyanmasını yalnızca kuyruk, günlük tavan ve
  // karşılanabilir seçenek olup olmadığı belirler.
  const decision = shouldWake(order(), game({ quota: 0 }), T0);
  assert.equal(decision.act, true);
});

test("karşılanabilir seçenek yoksa model çağrılmaz", () => {
  const broke = game({ resources: { gold: 0, food: 0, stone: 0, wood: 0, iron: 0, ale: 0 } });
  const decision = shouldWake(order(), broke, T0);
  assert.equal(decision.act, false);
  assert.match(decision.reason, /Karşılanabilir hiçbir emir yok/);
});

test("uygun seçenek varsa uyanır ve seçenekleri listeler", () => {
  const decision = shouldWake(order(), game(), T0);
  assert.equal(decision.act, true);
  if (!decision.act) return;
  assert.ok(decision.options.length > 0);
  assert.ok(decision.options.some(option => option.startsWith("quarry")));
});

test("açlık acil durum olarak işaretlenir", () => {
  const starving = game({ resources: { gold: 1000, food: 30, stone: 300, wood: 300, iron: 100, ale: 0 }, buildings: [{ type: "keep", name: "Kale", category: "Yönetim", level: 1 }], population: 400 });
  assert.match(String(detectEmergency(starving)), /Yiyecek/);
});

test("isyan eşiği acil durumdur", () => {
  assert.match(String(detectEmergency(game({ popularity: 12 }))), /isyan/);
});

test("sağlıklı krallıkta acil durum yoktur", () => {
  assert.equal(detectEmergency(game()), null);
});

test("kuyruk doluyken karşılanabilir seçenek üretilmez", () => {
  const busy = game({ queue: { kind: "unit", type: "spearman", name: "5 Mızrakçı", count: 5, startedAt: T0, completesAt: T0 + 100000 } });
  assert.deepEqual(affordableOptions(busy), []);
});

test("sıkıştırılmış bağlam küçük kalır", () => {
  const decision = shouldWake(order(), game(), T0);
  assert.equal(decision.act, true);
  if (!decision.act) return;
  const size = JSON.stringify(compactContext(game(), order(), decision)).length;
  assert.ok(size < 700, `bağlam ${size} karakter; gece vardiyası için fazla büyük`);
});
