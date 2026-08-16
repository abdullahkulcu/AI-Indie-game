import assert from "node:assert/strict";
import test from "node:test";
import { projectPublicKingdom } from "../server/world-projection";

test("aynı channel krallığı güvenli dünya özetine çevrilir", () => {
  const value = projectPublicKingdom("user-2", JSON.stringify({ kingdomName: "Kalendar", rulerName: "Kalen", channel: "Sınır Boyu", terrain: "forest", population: 103.8, buildings: [{ type: "keep", level: 2 }, { type: "wheat_farm", level: 1 }], units: { spearman: 7 }, resources: { gold: 91.8 } }), "Sınır Boyu");
  assert.deepEqual(value, { id: "user-2", name: "Kalendar", ruler: "Kalen", terrain: "forest", keepLevel: 2, population: 103, buildingCount: 2, army: 7, resources: { gold: 91 } });
});

test("başka channel veya bozuk kayıt dünya listesine sızmaz", () => {
  assert.equal(projectPublicKingdom("user-2", JSON.stringify({ kingdomName: "Uzak", channel: "Başka Dünya" }), "Sınır Boyu"), null);
  assert.equal(projectPublicKingdom("user-3", "bozuk-json", "Sınır Boyu"), null);
});
