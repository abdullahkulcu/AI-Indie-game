import assert from "node:assert/strict";
import test from "node:test";
import { SPOIL_RATE, applySpoilage, fillRatio, storageCaps } from "../engine/storage";
import type { Res } from "../engine/types";

const keepOnly = { buildings: [{ type: "keep", name: "Kale", category: "Yönetim", level: 1 }] };
const stocked = {
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
  const onlyGranary = storageCaps({ buildings: [{ type: "keep", name: "K", category: "Y", level: 1 }, { type: "granary", name: "A", category: "E", level: 5 }] });
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
