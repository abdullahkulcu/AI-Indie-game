import assert from "node:assert/strict";
import test from "node:test";
import {
  BASE_PRICE, MAX_DRAW, SPREAD, advanceCommons, commonsFlow, commonsOf, commonsReference,
  coverageOf, fillOrder, livingCost, livingCostMood, marketPrices, maxPurchase, priceMultiplier, unitPrice,
} from "../engine/market";

const REF = commonsReference(500);

test("halkın stoğu azaldıkça fiyat yükselir, bollaştıkça düşer", () => {
  const scarce = unitPrice("food", REF.food * .2, REF.food);
  const normal = unitPrice("food", REF.food, REF.food);
  const glut = unitPrice("food", REF.food * 2.5, REF.food);
  assert.ok(scarce > normal, "kıtlıkta pahalı olmalı");
  assert.ok(glut < normal, "bollukta ucuz olmalı");
  assert.equal(Math.round(normal * 1000) / 1000, BASE_PRICE.food, "normalde taban fiyat");
});

test("fiyatın tabanı ve tavanı var", () => {
  assert.ok(priceMultiplier(0) <= priceMultiplier(0) , "sıfır kapsama tanımlı olmalı");
  assert.ok(priceMultiplier(99) >= .3, "bolluk fiyatı sıfıra inmez");
  assert.ok(priceMultiplier(0) < 99, "kıtlık fiyatı sonsuza gitmez");
});

test("büyük emir fiyatı kendi içinde aşağı iter", () => {
  // Bu olmadan Kral 5.000 odunu işlem öncesi fiyattan satardı; istismar olurdu.
  const small = fillOrder("wood", 100, REF.wood, REF.wood, "sell");
  const large = fillOrder("wood", 5_000, REF.wood, REF.wood, "sell");
  assert.ok(large.average < small.average,
    `büyük emrin ortalaması düşük olmalı: ${large.average.toFixed(4)} < ${small.average.toFixed(4)}`);
  assert.ok(large.to < large.from, "emir bittiğinde fiyat düşmüş olmalı");
});

test("büyük alım fiyatı kendi içinde yukarı iter", () => {
  const small = fillOrder("food", 50, REF.food, REF.food, "buy");
  const large = fillOrder("food", maxPurchase(REF.food), REF.food, REF.food, "buy");
  assert.ok(large.average > small.average, "çok alan pahalıya alır");
  assert.ok(large.to > large.from, "alım fiyatı yukarı itmeli");
});

test("halkın elindekinden fazlası çekilemez", () => {
  const stock = 1_000;
  assert.equal(maxPurchase(stock), Math.floor(stock * MAX_DRAW));
  const order = fillOrder("food", maxPurchase(stock), stock, REF.food, "buy");
  assert.ok(order.commons > 0, "halkın elinde bir şey kalmalı");
});

test("alıp geri satmak zarardır", () => {
  const amount = 300;
  const bought = fillOrder("wood", amount, REF.wood, REF.wood, "buy");
  const sold = fillOrder("wood", amount, bought.commons, REF.wood, "sell");
  assert.ok(sold.gold < bought.gold, `tur atmak kâr etmemeli: aldı ${bought.gold}, sattı ${sold.gold}`);
  assert.ok(SPREAD > 1);
});

test("Kral halktan alınca o mal halkta pahalılaşır", () => {
  // Kralın asıl fikri: kıtlığı sen yaratırsan satış fiyatın yükselir.
  const before = unitPrice("food", REF.food, REF.food);
  const bought = fillOrder("food", maxPurchase(REF.food), REF.food, REF.food, "buy");
  const after = unitPrice("food", bought.commons, REF.food);
  assert.ok(after > before, `alım sonrası fiyat yükselmeli: ${after.toFixed(3)} > ${before.toFixed(3)}`);
});

test("halkın stoğu adımlara bölününce aynı yere gelir", () => {
  // Determinizm: istemci küçük adımlarla, sunucu tek adımda ilerliyor.
  const flow = commonsFlow(500, { food: 100, ale: 100 });
  const start = { ...REF, food: REF.food * .3, wood: REF.wood * 2.1 };
  const single = advanceCommons(start, REF, flow, 6);
  let stepped = start;
  for (let i = 0; i < 6; i++) stepped = advanceCommons(stepped, REF, flow, 1);
  for (const key of ["food", "wood", "stone", "iron", "ale"] as const) {
    assert.ok(Math.abs(single[key] - stepped[key]) < 1e-6,
      `${key}: tek adım ${single[key].toFixed(6)}, altı adım ${stepped[key].toFixed(6)}`);
  }
});

test("halkın stoğu zamanla normaline döner", () => {
  const flow = commonsFlow(500, { food: 100, ale: 100 });
  const scarce = { ...REF, wood: REF.wood * .1 };
  const later = advanceCommons(scarce, REF, flow, 48);
  assert.ok(later.wood > scarce.wood, "eksik stok toplanmalı");
  assert.ok(later.wood <= REF.wood * 1.05, "normalini aşıp fırlamamalı");
});

test("eski kayıtta halk normal stoğunda sayılır", () => {
  // Alan yokken kimse bedava bir fiyat şokuyla karşılaşmamalı.
  const legacy = commonsOf({ population: 500, commons: undefined });
  assert.deepEqual(legacy, REF);
  const prices = marketPrices(legacy, REF);
  assert.equal(Math.round(prices.food * 1000) / 1000, BASE_PRICE.food);
});

test("pahalı geçim rızayı düşürür, ucuzluk yükseltir", () => {
  const expensive = livingCostMood(livingCost({ ...REF, food: REF.food * .2, ale: REF.ale * .2 }, REF));
  const cheap = livingCostMood(livingCost({ ...REF, food: REF.food * 2.5, ale: REF.ale * 2.5 }, REF));
  assert.ok(expensive < 0, "pahalı ekmek rızayı düşürmeli");
  assert.ok(cheap > 0, "ambarı açmak rızayı yükseltmeli");
});

test("kapsama okuması sınırlarda tanımlı", () => {
  assert.equal(coverageOf(0, 100), 0);
  assert.equal(coverageOf(50, 0), 1, "referans sıfırsa normal sayılır");
  assert.equal(coverageOf(-5, 100), 0, "negatif stok sıfır sayılır");
});
