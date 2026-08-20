import { buildOptions, tick } from "../engine/tick";
import assert from "node:assert/strict";
import test from "node:test";
import { SPOIL_RATE, applySpoilage, fillRatio, storageCaps } from "../engine/storage";
import type { Game, Key, Res } from "../engine/types";

const T0 = 1_800_000_000_000;
/** Kilitlenme testi için taban krallık; adı base değil çünkü o ad test içinde yerel olarak kullanılıyor. */
const fixture = {
  version: 2, kingdomName: "D", rulerName: "A", channel: "Standart Sezon I", channelId: "standard",
  speed: 1, terrain: "plain", foundedAt: T0, lastTickAt: T0, protectionEndsAt: T0,
  resources: { gold: 0, food: 0, stone: 0, wood: 0, iron: 0, ale: 0 },
  population: 100, capacity: 150, popularity: 50, reputation: 50, loyalty: 75, taxRate: 15,
  units: {}, queue: null, notices: [], provider: null, model: null, generalConnected: false,
};

const keepOnly = { speed: 1, buildings: [{ type: "keep", name: "Kale", category: "Yönetim", level: 1 }] };
const stocked = {
  speed: 1,
  buildings: [
    { type: "keep", name: "Kale", category: "Yönetim", level: 3 },
    { type: "granary", name: "Ambar", category: "Ekonomi", level: 4 },
    { type: "warehouse", name: "Depo", category: "Ekonomi", level: 2 },
  ],
};

test("depo yokken bile bir miktar stok tutulur", () => {
  const caps = storageCaps(keepOnly);
  assert.ok(caps.food > 0 && caps.wood > 0, "kale mahzeni sıfır olmamalı");
});

test("ambar yiyecek ve birayı, depo odun ve taşı büyütür", () => {
  const base = storageCaps(keepOnly), big = storageCaps(stocked);
  assert.equal(big.food, base.food + 4 * 2600);
  assert.equal(big.ale, base.ale + 4 * 1100);
  assert.equal(big.wood, base.wood + 2 * 2200);
  assert.equal(big.stone, base.stone + 2 * 2200);
});

test("ambar odunu, depo yiyeceği büyütmez", () => {
  const onlyGranary = storageCaps({ speed: 1, buildings: [{ type: "keep", name: "K", category: "Y", level: 1 }, { type: "granary", name: "A", category: "E", level: 5 }] });
  assert.equal(onlyGranary.wood, storageCaps(keepOnly).wood, "ambar odun deposu değildir");
});

test("altın ve demirin tavanı yoktur", () => {
  // Hazine çürümez; tavan konsaydı Kral büyük bir inşaat için biriktiremezdi.
  // Demir zaten kıt, ayrıca cezalandırmak anlamsız.
  const caps = storageCaps(stocked);
  assert.equal(caps.gold, 0);
  assert.equal(caps.iron, 0);
  const rich = { gold: 999_999, food: 0, stone: 0, wood: 0, iron: 999_999, ale: 0 };
  assert.deepEqual(applySpoilage(rich, caps, 100).lost, {}, "altın ve demir bozulmamalı");
});

test("tavanın altındaki stok bozulmaz", () => {
  const resources: Res = { gold: 100, food: 100, stone: 100, wood: 100, iron: 100, ale: 100 };
  const result = applySpoilage(resources, storageCaps(keepOnly), 24);
  assert.deepEqual(result.resources, resources);
  assert.deepEqual(result.lost, {});
});

test("aşan stok anında silinmez, oranla bozulur", () => {
  // Kral depo kurmaya ya da satmaya vakit bulsun diye kırpma değil erime.
  const caps = storageCaps(keepOnly);
  const resources: Res = { gold: 0, food: caps.food + 10_000, stone: 0, wood: 0, iron: 0, ale: 0 };
  const oneHour = applySpoilage(resources, caps, 1);
  assert.ok(oneHour.resources.food > caps.food, "bir saatte tavana inmemeli");
  assert.equal(Math.round(oneHour.lost.food!), Math.round(caps.food * SPOIL_RATE));

  const oneDay = applySpoilage(resources, caps, 24);
  assert.ok(oneDay.resources.food < oneHour.resources.food, "uzun sürede daha çok bozulmalı");
});

test("bozulma tavanın altına indirmez", () => {
  const caps = storageCaps(keepOnly);
  const resources: Res = { gold: 0, food: caps.food + 500, stone: 0, wood: 0, iron: 0, ale: 0 };
  const result = applySpoilage(resources, caps, 1000);
  assert.ok(result.resources.food >= caps.food, `tavanın altına inmemeli, ölçülen: ${result.resources.food}`);
});

test("doluluk oranı okunur", () => {
  const caps = storageCaps(keepOnly);
  const resources: Res = { gold: 0, food: caps.food / 2, stone: 0, wood: 0, iron: 0, ale: 0 };
  assert.equal(fillRatio(resources, caps, "food"), .5);
});

test("bozulma adımlara bölününce aynı sonucu verir", () => {
  // Motorun determinizmi buna bağlı: istemci küçük adımlarla, sunucu tek
  // adımda ilerliyor. Üstel erime bu eşitliği bozuyordu.
  const caps = storageCaps(keepOnly);
  const start: Res = { gold: 0, food: caps.food + 9_000, stone: 0, wood: 0, iron: 0, ale: 0 };
  const single = applySpoilage(start, caps, 6).resources.food;
  let stepped = start;
  for (let i = 0; i < 6; i++) stepped = applySpoilage(stepped, caps, 1).resources;
  assert.ok(Math.abs(stepped.food - single) < 1e-9, `tek adım ${single}, altı adım ${stepped.food}`);
});

test("depo taşması defteri doldurmaz", () => {
  // Kralın 20 satırlık defterinin 16'sı taşma uyarısı olmuştu: engel "en
  // üstteki bildirim AMBAR mı" diye bakıyordu ve araya başka bildirim girince
  // sıfırlanıyordu. Artık zamana bağlı.
  const T0 = 1_800_000_000_000;
  const over = {
    version: 2 as const, kingdomName: "D", rulerName: "A", channel: "Standart Sezon I", channelId: "standard",
    speed: 1, terrain: "plain" as const, foundedAt: T0, lastTickAt: T0, protectionEndsAt: T0,
    resources: { gold: 0, food: 50_000, stone: 0, wood: 0, iron: 0, ale: 0 },
    population: 100, capacity: 150, popularity: 60, reputation: 50, loyalty: 75, taxRate: 15, quota: 0, quotaAt: T0,
    buildings: [{ type: "keep", name: "Kale", category: "Yönetim", level: 1 }],
    units: {}, queue: null, notices: [], provider: null, model: null, generalConnected: false,
  };
  // Saniyede bir ilerleyen istemci gibi 40 kez küçük adım at.
  let game: Game = over;
  for (let i = 1; i <= 40; i++) game = tick(game, T0 + i * 2000);
  const spam = game.notices.filter(notice => notice.kind === "AMBAR").length;
  assert.ok(spam <= 1, `40 adımda en fazla bir uyarı olmalı, ölçülen: ${spam}`);
});

test("hiçbir channel hızında yükseltme tavanın üstünde kalmaz", () => {
  // KİLİTLENME TESTİ. Malzeme maliyeti channel hızıyla çarpılıyor; tavan
  // çarpılmazsa gereken miktar hiçbir zaman biriktirilemez. Kralın hız 24
  // channel'ında Depo Sv.2 için 4.884 odun gerekiyordu, tavan 3.700 tutuyordu.
  for (const speed of [1, 4, 24]) {
    const game = {
      ...fixture, speed,
      buildings: [
        { type: "keep", name: "Kale", category: "Yönetim", level: 6 },
        // Sv.5: tavana ulaşan bina `buildOptions`tan düştüğü için Sv.6 depo/ambar
        // hiç seçenek üretmezdi ve bu kontrol boşa dönerdi. Sv.5 ile en pahalı
        // GERÇEK yükseltme (Sv.6) yine ölçülüyor.
        { type: "granary", name: "Ambar", category: "Ekonomi", level: 5 },
        { type: "warehouse", name: "Depo", category: "Ekonomi", level: 5 },
      ],
    } as unknown as Game;
    const caps = storageCaps(game);
    for (const option of buildOptions(game)) {
      for (const [key, amount] of Object.entries(option.cost) as Array<[Key, number]>) {
        const cap = caps[key];
        if (!(cap > 0)) continue; // altın ve demirin tavanı yok
        assert.ok(amount <= cap,
          `hız ${speed}: ${option.type} Sv.${option.nextLevel} için ${key} ${amount} gerekiyor ama tavan ${Math.round(cap)}`);
      }
    }
  }
});

test("tavan channel hızıyla ölçeklenir", () => {
  const slow = storageCaps({ speed: 1, buildings: [{ type: "warehouse", name: "D", category: "E", level: 1 }] });
  const fast = storageCaps({ speed: 24, buildings: [{ type: "warehouse", name: "D", category: "E", level: 1 }] });
  assert.equal(fast.wood, slow.wood * 24);
  assert.equal(fast.gold, 0, "altının tavanı yine yok");
});
