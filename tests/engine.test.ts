import assert from "node:assert/strict";
import test from "node:test";
import { applyActions } from "../engine/actions";
import { costFor, keep, rates, tick } from "../engine/tick";
import type { Game } from "../engine/types";

const T0 = 1_800_000_000_000;

function newGame(overrides: Partial<Game> = {}): Game {
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
    units: { spearman: 0 }, queue: null, notices: [], provider: null, model: null, generalConnected: false,
    ...overrides,
  };
}

test("başlangıç üretim hızları oyunun gösterdiği değerlerle aynı", () => {
  const r = rates(newGame());
  assert.equal(Math.round(r.gold * 10) / 10, 3.3);
  assert.equal(Math.round(r.food * 10) / 10, 14.5);
  assert.equal(Math.round(r.wood * 10) / 10, 22);
  assert.equal(r.stone, 0);
});

test("arazi çarpanları üretime yansır", () => {
  assert.ok(rates(newGame({ terrain: "forest" })).wood > rates(newGame()).wood);
  assert.ok(rates(newGame({ terrain: "riverbank" })).food > rates(newGame()).food);
});

test("bir saatlik tick kaynakları üretim hızı kadar artırır", () => {
  const before = newGame();
  const after = tick(before, T0 + 3_600_000);
  assert.equal(Math.round(after.resources.wood), Math.round(before.resources.wood + rates(before).wood));
  assert.equal(after.lastTickAt, T0 + 3_600_000);
});

test("çevrimdışı kazanç 24 saatle sınırlıdır", () => {
  const week = tick(newGame(), T0 + 7 * 86_400_000);
  const day = tick(newGame(), T0 + 86_400_000);
  assert.equal(Math.round(week.resources.wood), Math.round(day.resources.wood));
});

test("channel hızı tick'i çarpar", () => {
  const slow = tick(newGame({ speed: 1 }), T0 + 3_600_000);
  const fast = tick(newGame({ speed: 4 }), T0 + 3_600_000);
  assert.ok(fast.resources.wood > slow.resources.wood);
});

test("kuyruk tamamlanınca bina eklenir ve bildirim düşer", () => {
  const queued = newGame({ queue: { kind: "building", type: "quarry", name: "Taş Ocağı Sv.1", targetLevel: 1, startedAt: T0, completesAt: T0 + 1000 } });
  const after = tick(queued, T0 + 2000);
  assert.equal(after.queue, null);
  assert.equal(after.buildings.find(b => b.type === "quarry")?.level, 1);
  assert.match(after.notices[0].text, /tamamlandı/);
});

test("tick emir kotası biriktirmez; alan olduğu gibi taşınır", () => {
  const after = tick(newGame({ quota: 0 }), T0 + 20 * 3_600_000);
  assert.equal(after.quota, 0, "kota birikimi kaldırıldı");
  assert.equal(after.quotaAt, T0, "kota zamanı da ilerletilmez");
});

test("maliyet seviyeyle 1.65 kat büyür", () => {
  assert.deepEqual(costFor({ wood: 80 }, 0), { wood: 80 });
  assert.deepEqual(costFor({ wood: 80 }, 1), { wood: 132 });
});

test("kale seviyesi binalardan okunur", () => {
  assert.equal(keep(newGame()), 1);
  assert.equal(keep(newGame({ buildings: [{ type: "keep", name: "Kale", category: "Yönetim", level: 4 }] })), 4);
});

test("bina emri kaynak düşer ve kuyruğa alır; kota harcamaz", () => {
  const before = newGame();
  const { game, results } = applyActions(before, [{ name: "build_structure", arguments: { building_type: "quarry", target_level: 1 } }], T0);
  assert.match(results[0], /^✓/);
  assert.equal(game.queue?.type, "quarry");
  assert.equal(game.quota, before.quota, "emir kotadan düşmemeli");
  assert.equal(game.resources.wood, before.resources.wood - 100);
  assert.equal(game.resources.gold, before.resources.gold - 60);
});

test("kuyruk doluyken ikinci inşa emri engellenir", () => {
  const busy = newGame({ queue: { kind: "building", type: "quarry", name: "Taş Ocağı Sv.1", targetLevel: 1, startedAt: T0, completesAt: T0 + 9_000_000 } });
  const { results } = applyActions(busy, [{ name: "build_structure", arguments: { building_type: "mill", target_level: 1 } }], T0);
  assert.match(results[0], /^✕/);
  assert.match(results[0], /kuyruğu dolu/);
});

test("kale kilidi olmayan bina reddedilir", () => {
  const { results } = applyActions(newGame(), [{ name: "build_structure", arguments: { building_type: "wall", target_level: 1 } }], T0);
  assert.match(results[0], /Kale Sv\.3 gerekli/);
});

test("kışla olmadan asker eğitilemez", () => {
  const { results } = applyActions(newGame(), [{ name: "train_unit", arguments: { unit_type: "spearman", count: 5 } }], T0);
  assert.match(results[0], /Kışla kurulmalı/);
});

test("kota sıfırken bile emirler uygulanır", () => {
  const { game, results } = applyActions(newGame({ quota: 0 }), [{ name: "build_structure", arguments: { building_type: "quarry", target_level: 1 } }], T0);
  assert.match(results[0], /^✓/);
  assert.equal(game.queue?.type, "quarry");
});

test("art arda çok sayıda emir yalnızca kaynak ve kuyrukla sınırlanır", () => {
  // Kota kalktı: aynı turda üç şenlik de uygulanır, kaynak yettiği sürece.
  const rich = newGame({ resources: { gold: 5000, food: 5000, stone: 300, wood: 300, iron: 100, ale: 0 } });
  const many = Array.from({ length: 3 }, () => ({ name: "host_festival", arguments: {} }));
  const { game, results } = applyActions(rich, many, T0);
  assert.equal(results.filter(line => line.startsWith("✓")).length, 3);
  assert.equal(game.resources.gold, 5000 - 3 * 120);
});

test("kaynak bitince emir engellenir; engelleyen kota değil hazinedir", () => {
  const poor = newGame({ resources: { gold: 0, food: 0, stone: 0, wood: 0, iron: 0, ale: 0 } });
  const { results } = applyActions(poor, [{ name: "host_festival", arguments: {} }], T0);
  assert.match(results[0], /^✕/);
  assert.match(results[0], /altın ve 150 yiyecek gerekli/);
});

test("yüksek vergi teyitsiz uygulanmaz, teyitli uygulanır", () => {
  const blockedRun = applyActions(newGame(), [{ name: "set_tax_rate", arguments: { rate_percent: 45 } }], T0);
  assert.match(blockedRun.results[0], /^✕/);
  const allowed = applyActions(newGame(), [{ name: "set_tax_rate", arguments: { rate_percent: 45, confirmed_risk: true } }], T0);
  assert.match(allowed.results[0], /^✓/);
  assert.equal(allowed.game.taxRate, 45);
});

test("itirazı ezen emir sadakati düşürür, rutin emir yükseltir", () => {
  const routine = applyActions(newGame(), [{ name: "build_structure", arguments: { building_type: "quarry", target_level: 1 } }], T0);
  assert.equal(routine.game.loyalty, 75.5);
  const forced = applyActions(newGame(), [{ name: "set_tax_rate", arguments: { rate_percent: 45, confirmed_risk: true } }], T0);
  assert.ok(forced.game.loyalty < 75, "ezilen itiraz sadakati düşürmeli");
});

test("şenlik halkın rızasını yükseltir ve kaynak harcar", () => {
  const { game, results } = applyActions(newGame(), [{ name: "host_festival", arguments: {} }], T0);
  assert.match(results[0], /^✓/);
  assert.equal(game.popularity, 62);
  assert.equal(game.resources.gold, 880);
});

test("sunucu eylemleri motoru değiştirmez, remote listesine düşer", () => {
  const before = newGame();
  const { game, remote, results } = applyActions(before, [{ name: "send_miners", arguments: { workers: 8 } }], T0);
  assert.equal(remote.length, 1);
  assert.equal(results.length, 0);
  assert.deepEqual(game.resources, before.resources);
});

test("bilinmeyen araç reddedilir", () => {
  const { results } = applyActions(newGame(), [{ name: "altin_bas", arguments: {} }], T0);
  assert.match(results[0], /yetkili değil/);
});

test("tur başına en fazla üç eylem işlenir", () => {
  const many = Array.from({ length: 6 }, () => ({ name: "host_festival", arguments: {} }));
  const { results } = applyActions(newGame({ resources: { gold: 5000, food: 5000, stone: 300, wood: 300, iron: 100, ale: 0 } }), many, T0);
  assert.equal(results.length, 3);
});
