import assert from "node:assert/strict";
import test from "node:test";
import { MINE_ELAPSED_CAP_HOURS, ORE_DELIVERY_INTERVAL_MS, ORE_PER_WORKER_HOUR, oreRate, settleMine, type MineCrew } from "../engine/mine";
import { tick } from "../engine/tick";
import { validateGameSave } from "../server/save-validation";
import type { Game } from "../engine/types";

const NOW = 1_800_000_000_000;
const crew = (overrides: Partial<MineCrew> = {}): MineCrew =>
  ({ userId: "u1", workers: 5, pendingOre: 0, lastDeliveryAt: 0, ...overrides });

// --- verim ------------------------------------------------------------------

test("işçi başına saatlik verim tek kaynaktan gelir", () => {
  assert.equal(oreRate(1, 1), ORE_PER_WORKER_HOUR);
  assert.equal(oreRate(5, 1), 5 * ORE_PER_WORKER_HOUR);
  assert.equal(oreRate(5, 24), 5 * ORE_PER_WORKER_HOUR * 24);
  assert.equal(oreRate(0, 24), 0);
});

test("bir saat çalışan ekip işçi başına ORE_PER_WORKER_HOUR cevher alır", () => {
  const settled = settleMine([crew({ workers: 5 })], { speed: 1, hours: 1, oreRemaining: 100_000, now: NOW });
  // Teslim hemen yapılır (lastDeliveryAt = 0, yani hiç teslim alınmamış).
  assert.equal(settled.extracted, 20);
  assert.equal(settled.shares[0].delivered, 20);
  assert.equal(settled.shares[0].pendingOre, 0);
});

test("hızlı channel'da verim hızla çarpılır", () => {
  const fast = settleMine([crew({ workers: 5 })], { speed: 24, hours: 1, oreRemaining: 100_000, now: NOW });
  assert.equal(fast.extracted, 20 * 24);
});

// --- küsurat kaybolmaz ------------------------------------------------------

test("adımlara bölünen hesap tek adımla aynı cevheri verir", () => {
  // ESKİ HATA: her istekte `Math.floor` alınıp kalan çöpe atılıyordu. Maden 10
  // saniyede bir yoklandığı için 5 işçinin ürettiği hep 0'a yuvarlanıyor,
  // yani madene işçi göndermek saf zarar oluyordu.
  const single = settleMine([crew({ workers: 5, lastDeliveryAt: NOW })], {
    speed: 1, hours: 1, oreRemaining: 100_000, now: NOW + 3_600_000,
  });

  let row = crew({ workers: 5, lastDeliveryAt: NOW });
  let delivered = 0;
  for (let step = 1; step <= 360; step += 1) {
    const at = NOW + step * 10_000; // 10 saniyelik adımlar
    const settled = settleMine([row], { speed: 1, hours: 10 / 3600, oreRemaining: 100_000 - delivered, now: at });
    delivered += settled.extracted;
    row = { ...settled.shares[0], lastDeliveryAt: settled.shares[0].delivered > 0 ? at : row.lastDeliveryAt };
  }
  assert.equal(delivered, single.extracted);
  assert.equal(delivered, 20);
});

// --- teslimat aralığı -------------------------------------------------------

test("teslimat aralığı dolmadan cevher kayda yazılmaz, ama birikir", () => {
  const settled = settleMine([crew({ workers: 5, lastDeliveryAt: NOW })], {
    speed: 1, hours: 1, oreRemaining: 100_000, now: NOW + ORE_DELIVERY_INTERVAL_MS - 1,
  });
  assert.equal(settled.extracted, 0);
  assert.equal(settled.shares[0].pendingOre, 20);
});

test("işçilerini çeken oyuncuya biriken cevher hemen ödenir", () => {
  const waiting = crew({ workers: 5, pendingOre: 7.4, lastDeliveryAt: NOW });
  const settled = settleMine([waiting], {
    speed: 1, hours: 0, oreRemaining: 100_000, now: NOW + 1000, forceUserId: "u1",
  });
  assert.equal(settled.shares[0].delivered, 7);
  assert.equal(Math.round(settled.shares[0].pendingOre * 10) / 10, .4);
});

// --- damar ------------------------------------------------------------------

test("damarda kalandan fazlası çıkarılamaz; bekleyen paylar da sayılır", () => {
  const settled = settleMine(
    [crew({ userId: "a", workers: 10 }), crew({ userId: "b", workers: 10, pendingOre: 30 })],
    { speed: 1, hours: 5, oreRemaining: 50, now: NOW },
  );
  const total = settled.shares.reduce((sum, share) => sum + share.delivered + share.pendingOre, 0);
  assert.ok(total <= 50, `damardan fazlası dağıtıldı: ${total}`);
  assert.equal(settled.extracted, 50);
});

test("çevrimdışı kazanç tavanı vardır", () => {
  const long = settleMine([crew({ workers: 5 })], { speed: 1, hours: 240, oreRemaining: 100_000, now: NOW });
  assert.equal(long.extracted, 5 * ORE_PER_WORKER_HOUR * MINE_ELAPSED_CAP_HOURS);
});

test("aynı girdi aynı çıktıyı verir; sıra istikrarlıdır", () => {
  const rows = [crew({ userId: "z", workers: 9 }), crew({ userId: "a", workers: 9 })];
  const first = settleMine(rows, { speed: 1, hours: 2, oreRemaining: 40, now: NOW });
  const second = settleMine([...rows].reverse(), { speed: 1, hours: 2, oreRemaining: 40, now: NOW });
  assert.deepEqual(first.shares, second.shares);
});

// --- hile koruması ----------------------------------------------------------
// Cevheri SUNUCU kayda yazar (sürüm korumalı). Bu yüzden cevher, istemcinin bir
// sonraki kaydı denetlenirken zaten `previous`ın içindedir ve tavan kendiliğinden
// doğru kalır. Aşağıdaki iki test o dengenin iki ucunu tutar.

/** Kendi kendine yeten kayıt: başlangıç sabitleri değişse de bu test ayakta kalır. */
const RESOURCES = { gold: 1000, food: 500, stone: 300, wood: 300, iron: 100, ale: 0 };
const PROTECTION_DAYS = 4;

function saveOf(overrides: Record<string, unknown> = {}) {
  return {
    version: 2, kingdomName: "Demirkale", rulerName: "Alaric", channel: "Standart Sezon I", channelId: "standard",
    speed: 1, terrain: "plain", foundedAt: NOW - 86_400_000, lastTickAt: NOW,
    protectionEndsAt: NOW - 86_400_000 + PROTECTION_DAYS * 86_400_000,
    resources: { ...RESOURCES }, population: 100, capacity: 150,
    popularity: 50, reputation: 50, loyalty: 75, taxRate: 15,
    buildings: [
      { type: "keep", name: "Kale", category: "Yönetim", level: 1 },
      { type: "wheat_farm", name: "Buğday Tarlası", category: "Ekonomi", level: 1 },
      { type: "lumberjack", name: "Oduncu Kulübesi", category: "Ekonomi", level: 1 },
    ],
    units: { spearman: 0 }, queue: null, notices: [], provider: null, model: null, generalConnected: false,
    mineWorkers: 5,
    ...overrides,
  };
}

const options = (previous: Record<string, unknown>, at: number) =>
  ({ previous: previous as never, previousUpdatedAt: at, channelSpeed: 1, channelName: "Standart Sezon I", now: at });

test("sunucunun yazdığı cevheri taşıyan kayıt reddedilmez", () => {
  // Sunucu 240 cevheri doğrudan kayda yazdı: `previous` onu içeriyor.
  const previous = saveOf({ resources: { ...RESOURCES, iron: RESOURCES.iron + 240 } });
  const later = NOW + 3_600_000;
  const reported = tick(previous as unknown as Game, later);
  const result = validateGameSave({ ...reported, notices: [] }, options(previous, later));
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  assert.equal(reported.resources.iron, RESOURCES.iron + 240);
});

test("sunucunun yazmadığı cevheri bildiren istemci reddedilir", () => {
  const previous = saveOf();
  const later = NOW + 3_600_000;
  const reported = tick(previous as unknown as Game, later);
  const cheated = { ...reported, notices: [], resources: { ...reported.resources, iron: reported.resources.iron + 5_000 } };
  const result = validateGameSave(cheated, options(previous, later));
  assert.equal(result.ok, false);
});

test("madene işçi göndermiş eski kayıt (mineWorkers dolu) hâlâ kabul edilir", () => {
  const previous = saveOf();
  const later = NOW + 600_000;
  const reported = tick(previous as unknown as Game, later);
  const result = validateGameSave({ ...reported, notices: [] }, options(previous, later));
  assert.equal(result.ok, true, result.ok ? "" : result.error);
});
