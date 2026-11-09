import assert from "node:assert/strict";
import test from "node:test";
import { civicResponseForDefense, defenderWarAftermath, warDisruptionForDefense } from "../engine/war-populace";

test("yüksek rıza ve dolu ambar halk desteği doğurur", () => {
  const response = civicResponseForDefense({ popularity: 72, factionPressure: 12, soldierUnrest: 8, food: 600 });
  assert.equal(response.id, "support");
  assert.equal(response.moraleBonus, 8);
  assert.equal(response.withdrawThreshold, 40);
  assert.equal(response.action, "Mahalle savunması");
});

test("aç veya bölünmüş şehir savunmada barış baskısı üretir", () => {
  const response = civicResponseForDefense({ popularity: 55, factionPressure: 15, soldierUnrest: 10, food: 20 });
  assert.equal(response.id, "pressure");
  assert.equal(response.moraleBonus, -6);
  assert.equal(response.withdrawThreshold, 60);
  assert.equal(response.action, "Barış heyeti");
});

test("halkın özerk tavrı savunmanın geri çekilme eşiğini gerçekten değiştirir", () => {
  const watch = civicResponseForDefense({ popularity: 55, factionPressure: 15, soldierUnrest: 10, food: 200 });
  assert.equal(watch.withdrawThreshold, 50);
  assert.ok(watch.withdrawThreshold > civicResponseForDefense({ popularity: 72, factionPressure: 12, soldierUnrest: 8, food: 600 }).withdrawThreshold);
  assert.ok(watch.withdrawThreshold < civicResponseForDefense({ popularity: 30, factionPressure: 70, soldierUnrest: 10, food: 20 }).withdrawThreshold);
});

test("savunanın kaybı ve yağma rızayı düşürür; değerler sınırda kalır", () => {
  const result = defenderWarAftermath({
    objective: "siege", defenderUnitsBefore: 10, defenderLosses: 10,
    loot: { gold: 100, food: 100 }, civicResponse: "pressure", popularity: 8, factionPressure: 98,
  });
  assert.equal(result.popularity, 0);
  assert.equal(result.factionPressure, 100);
  assert.ok(result.severity > 10);
});

test("halk desteği eş kayıpta savaş sarsıntısını azaltır", () => {
  const base = { objective: "raid" as const, defenderUnitsBefore: 20, defenderLosses: 4, loot: { gold: 0, food: 0 }, popularity: 70, factionPressure: 5 };
  assert.ok(
    defenderWarAftermath({ ...base, civicResponse: "support" }).severity
      < defenderWarAftermath({ ...base, civicResponse: "pressure" }).severity,
  );
});

test("savunan tarafın üretim hasarı süreli, sınırlı ve önceki hasarı koruyandır", () => {
  const first = warDisruptionForDefense({ severity: 10, speed: 4, now: 1_000 });
  assert.equal(first.productionPenalty, .22);
  assert.equal(first.until, 28 * 3_600_000 / 4 + 1_000);
  const extended = warDisruptionForDefense({ severity: 1, speed: 4, now: 2_000, previous: first });
  assert.equal(extended.productionPenalty, first.productionPenalty);
  assert.equal(extended.until, first.until);
  assert.equal(warDisruptionForDefense({ severity: 99, speed: 1, now: 0 }).productionPenalty, .4);
});
