import assert from "node:assert/strict";
import test from "node:test";
import {
  WORLD_EVENT_ACTIVE_HOURS, WORLD_EVENT_EPOCH, WORLD_EVENT_WINDOW_HOURS,
  activeWorldEventAt, worldEventInWindow, worldEventIntervals, worldEventMultiplier,
  worldEventStatusAt, worldEventsStartedBetween,
  type WorldEvent,
} from "../engine/world-events";
import { tick } from "../engine/tick";
import type { Game } from "../engine/types";

const HOUR = 3_600_000;

function game(overrides: Partial<Game> = {}): Game {
  return {
    version: 2, kingdomName: "Demirkale", rulerName: "Alaric", channel: "Hızlı Taç", channelId: "rapid-crown",
    speed: 1, terrain: "plain", foundedAt: WORLD_EVENT_EPOCH, lastTickAt: WORLD_EVENT_EPOCH, protectionEndsAt: WORLD_EVENT_EPOCH,
    resources: { gold: 100, food: 100, stone: 100, wood: 100, iron: 100, ale: 0 },
    population: 100, capacity: 150, popularity: 50, reputation: 50, loyalty: 75, taxRate: 15, quota: 0, quotaAt: WORLD_EVENT_EPOCH,
    buildings: [{ type: "keep", name: "Kale", category: "Yönetim", level: 1 }], units: {}, queue: null, notices: [], provider: null, model: null, generalConnected: false,
    ...overrides,
  };
}

test("channel dünya olayı aynı channel için kararlı, farklı channel için bağımsızdır", () => {
  const ours = game();
  assert.deepEqual(worldEventInWindow(ours, 12), worldEventInWindow(ours, 12));
  const other = game({ channelId: "other-channel" });
  const oursTimeline = Array.from({ length: 80 }, (_, window) => worldEventInWindow(ours, window).kind).join(",");
  const otherTimeline = Array.from({ length: 80 }, (_, window) => worldEventInWindow(other, window).kind).join(",");
  assert.notEqual(oursTimeline, otherTimeline, "tohum krallığa değil channel kimliğine bağlı olmalı");
});

test("olay dizisi olumlu ve olumsuz dönemleri yarı yarıya seçme olasılığıyla taşır", () => {
  const tones = Array.from({ length: 240 }, (_, window) => worldEventInWindow(game(), window).tone);
  const favorable = tones.filter(tone => tone === "favorable").length;
  assert.ok(favorable > 70 && favorable < 170, "tek yöne kilitlenmiş bir olay dizisi olmamalı");
  assert.ok(tones.includes("adverse") && tones.includes("favorable"));
});

test("aktif dönemden sonra General için yaklaşan olay uyarısı kalır", () => {
  const ours = game();
  const start = WORLD_EVENT_EPOCH + 3 * WORLD_EVENT_WINDOW_HOURS * HOUR;
  const active = worldEventStatusAt(ours, start + HOUR);
  assert.equal(active.phase, "active");
  const warning = worldEventStatusAt(ours, start + WORLD_EVENT_ACTIVE_HOURS * HOUR + HOUR);
  assert.equal(warning.phase, "warning");
  assert.ok(warning.startsAt > start);
});

test("arazi ve hazırlık, aynı kıtlığın etkisini değiştirir", () => {
  const drought: WorldEvent = { kind: "drought", tone: "adverse", label: "Kuraklık", summary: "", advice: "", startsAt: 0, endsAt: HOUR };
  const mountain = worldEventMultiplier(game({ terrain: "mountain" }), drought);
  const river = worldEventMultiplier(game({ terrain: "riverbank" }), drought);
  const preparedMountain = worldEventMultiplier(game({ terrain: "mountain", buildings: [
    { type: "keep", name: "Kale", category: "Yönetim", level: 1 },
    { type: "granary", name: "Ambar", category: "Ekonomi", level: 3 },
    { type: "mill", name: "Değirmen", category: "Ekonomi", level: 2 },
  ] }), drought);
  assert.ok(river.food > mountain.food, "nehir kıyısı kuraklığı dağdan daha hafif yaşamalı");
  assert.ok(preparedMountain.food > mountain.food, "ambar ve değirmen gıda şokunu hafifletmeli");
});

test("olay sınırı üretim aralığını böler ve başlangıcı yalnız bir kez bildirir", () => {
  const ours = game();
  const from = WORLD_EVENT_EPOCH + (WORLD_EVENT_WINDOW_HOURS - 2) * HOUR;
  const to = from + 4 * HOUR;
  const intervals = worldEventIntervals(ours, from, to);
  assert.equal(intervals.length, 2);
  assert.equal(intervals[0].event, null, "uyarı safhası üretimi değiştirmez");
  assert.ok(intervals[1].event, "sonraki çevrimde olay başlamalı");
  assert.equal(activeWorldEventAt(ours, intervals[1].from)?.startsAt, intervals[1].from);
  assert.equal(worldEventsStartedBetween(ours, from, to).length, 1);
});

test("dünya olayı sınırı tek büyük tick ile saatlik tick'lerde aynı olaylı üretimi verir", () => {
  const from = WORLD_EVENT_EPOCH + (WORLD_EVENT_WINDOW_HOURS - 2) * HOUR;
  const base = game({
    lastTickAt: from, popularity: 72, resources: { gold: 10_000, food: 10_000, stone: 1_000, wood: 1_000, iron: 100, ale: 100 },
    buildings: [
      { type: "keep", name: "Kale", category: "Yönetim", level: 2 },
      { type: "wheat_farm", name: "Buğday Tarlası", category: "Ekonomi", level: 2 },
      { type: "lumberjack", name: "Oduncu Kulübesi", category: "Ekonomi", level: 2 },
      { type: "granary", name: "Ambar", category: "Ekonomi", level: 2 },
    ],
    units: { spearman: 40 }, watchRatio: 100,
  });
  const once = tick(base, from + 4 * HOUR);
  let stepped = base;
  for (let hour = 1; hour <= 4; hour += 1) stepped = tick(stepped, from + hour * HOUR);
  // Olay yalnız üretim kalemlerine dokunur. Altın nüfus/rıza eğrisinin mevcut
  // kapalı çözümünden geldiği için burada yeni olay kuralını onunla karıştırmıyoruz.
  for (const key of ["food", "wood", "stone", "iron", "ale"] as const) assert.equal(once.resources[key], stepped.resources[key]);
  assert.equal(once.notices.filter(note => note.kind === "DÜNYA").length, 1);
  assert.equal(stepped.notices.filter(note => note.kind === "DÜNYA").length, 1);
});
