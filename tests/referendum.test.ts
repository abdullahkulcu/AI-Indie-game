import assert from "node:assert/strict";
import test from "node:test";
import { referendumCooldownMs, referendumQuestion, referendumSupport, referendumVerdict } from "../engine/referendum";

test("halk oylaması desteği her koşulda yüzde aralığında kalır", () => {
  for (const topic of ["tax_increase", "tax_relief", "food_cut", "food_relief"] as const) {
    const support = referendumSupport({ topic, popularity: 999, factionPressure: -20, taxRate: 99, foodRation: 999 });
    assert.ok(support >= 5 && support <= 95, `${topic}: ${support}`);
  }
});

test("oy oranı toplumsal sinyale ve sorunun bugünkü politikasına tepki verir", () => {
  const lowTrust = referendumSupport({ topic: "tax_relief", popularity: 20, factionPressure: 80, taxRate: 30, foodRation: 100 });
  const highTrust = referendumSupport({ topic: "tax_relief", popularity: 80, factionPressure: 0, taxRate: 30, foodRation: 100 });
  // Orta-düşük güventeki örnek, üst yüzde tavanına çarpmadan vergi farkını
  // ölçer; tavanda iki farklı girdi doğal olarak aynı %95'i verebilir.
  const lowTax = referendumSupport({ topic: "tax_relief", popularity: 10, factionPressure: 40, taxRate: 10, foodRation: 100 });
  const highTax = referendumSupport({ topic: "tax_relief", popularity: 10, factionPressure: 40, taxRate: 40, foodRation: 100 });
  assert.ok(highTrust > lowTrust);
  assert.ok(highTax > lowTax);
});

test("sonuç eşiği ve oyun haftası bekleme süresi belirgindir", () => {
  assert.equal(referendumVerdict(60), "supported");
  assert.equal(referendumVerdict(59), "divided");
  assert.equal(referendumVerdict(40), "opposed");
  assert.equal(referendumCooldownMs(1), 7 * 24 * 3_600_000);
  assert.equal(referendumCooldownMs(24), 7 * 24 * 3_600_000 / 24);
  assert.equal(referendumQuestion("food_cut"), "Yiyecek istihkakını azaltmalı mıyız?");
});
