import assert from "node:assert/strict";
import test from "node:test";
import { WAKE_INTERVAL_MS, affordableOptions, compactContext, detectEmergency, nightActionLimit, nightLedgerEvents, plannedNightActions, rollDailyWindow, shouldWake, successfulNightActions, type StandingOrder } from "../server/night-shift";
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
  assert.deepEqual(rollDailyWindow(spent, T0 + 61 * 60_000, 24), { actionsToday: 0, dayStartedAt: T0 + 61 * 60_000 });
  assert.equal(rollDailyWindow(spent, T0 + 30 * 60_000, 24).actionsToday, 8);
});

test("tek şantiye doluyken karşılanabilir başka emir yoksa model çağrılmaz", () => {
  const busy = game({ queue: { kind: "building", type: "quarry", name: "Taş Ocağı Sv.1", targetLevel: 1, startedAt: T0, completesAt: T0 + 9_000_000 } });
  const decision = shouldWake(order(), busy, T0);
  assert.equal(decision.act, false);
  assert.match(decision.reason, /Karşılanabilir hiçbir emir yok/);
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

test("asker eğitimi inşaat hattını kapatmaz", () => {
  const busy = game({ queue: { kind: "unit", type: "spearman", name: "5 Mızrakçı", count: 5, startedAt: T0, completesAt: T0 + 100000 } });
  assert.ok(affordableOptions(busy).some(option => option.startsWith("quarry")));
});

test("sıkıştırılmış bağlam küçük kalır", () => {
  const decision = shouldWake(order(), game(), T0);
  assert.equal(decision.act, true);
  if (!decision.act) return;
  const size = JSON.stringify(compactContext(game(), order(), decision)).length;
  assert.ok(size < 700, `bağlam ${size} karakter; gece vardiyası için fazla büyük`);
});

test("gece vardiyasının başarılı şenliği General defterine düşer", () => {
  const kinds = nightLedgerEvents(game(), "host_festival");
  assert.ok(kinds.includes("festival"));
  assert.ok(kinds.includes("fed_people"), "gece vardiyası güncel halk hâlini de kaydetmeli");
});

test("gece emri uyanış ve günlük eylem tavanını birlikte uygular", () => {
  assert.equal(nightActionLimit(order({ maxActionsPerWake: 3, actionsToday: 2, dailyActionCap: 8 })), 3);
  assert.equal(nightActionLimit(order({ maxActionsPerWake: 9, actionsToday: 7, dailyActionCap: 8 })), 1);
  assert.equal(nightActionLimit(order({ maxActionsPerWake: 3, actionsToday: 8, dailyActionCap: 8 })), 0);
});

test("gece planı yalnız izinli eylemleri ve uyanış sınırını geçirir", () => {
  const plan = plannedNightActions({ name: "night_plan", arguments: { actions: [
    { name: "host_festival", arguments: {} },
    { name: "send_miners", arguments: { workers: 5 } },
    { name: "train_unit", arguments: { unit_type: "spearman", count: 5 } },
  ] } }, 2);
  assert.deepEqual(plan.map(action => action.name), ["host_festival", "train_unit"]);
  assert.deepEqual(successfulNightActions(plan, ["✓ şenlik", "✕ eğitim"]), [plan[0]]);
});
