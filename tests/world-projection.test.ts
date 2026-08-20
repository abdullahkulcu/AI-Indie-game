import assert from "node:assert/strict";
import test from "node:test";
import { INTEL_REPORT_STALE_MS, intelReportOf, isStaleReport, projectPublicKingdom } from "../server/world-projection";

const KALENDAR = JSON.stringify({
  kingdomName: "Kalendar", rulerName: "Kalen", channel: "Sınır Boyu", terrain: "forest", population: 103.8,
  buildings: [{ type: "keep", level: 2 }, { type: "wheat_farm", level: 1 }], units: { spearman: 7 },
  resources: { gold: 91.8, food: 4200 },
});

test("aynı channel krallığı güvenli dünya özetine çevrilir", () => {
  const value = projectPublicKingdom("user-2", KALENDAR, "Sınır Boyu");
  assert.deepEqual(value, { id: "user-2", name: "Kalendar", ruler: "Kalen", terrain: "forest", keepLevel: 2, population: 103, buildingCount: 2, army: 7 });
});

/**
 * BLÖFÜN SINIRI. Ajan raporu karşı krallığın AMBARINI olduğu gibi taşıyordu:
 * arayüz göstermiyordu ama veri `intel_missions.report` içinde saklanıp
 * istemciye iniyordu. Tasarım notu şöyle diyor: "ajan raporu asker sayısını
 * verir ama nöbet oranını ve maaş durumunu vermez — kumar orada." Ambar da o
 * tarafta durur; bilinirse haraç pazarlığındaki bütün risk kalkar.
 */
test("ajan raporu ambarı vermez", () => {
  const kingdom = projectPublicKingdom("user-2", KALENDAR, "Sınır Boyu")!;
  const report = intelReportOf(kingdom);
  const serialized = JSON.stringify(report);
  assert.ok(!("resources" in (report as Record<string, unknown>)), "ambar raporda olmamalı");
  assert.ok(!serialized.includes("4200") && !serialized.includes("91"), "ambar rakamları hiçbir alanda sızmamalı");
  // Rapor asker sayısını VERİR: blöf, nöbet oranı ve maaş üzerinden yapılır.
  assert.equal(report.army, 7);
  assert.equal(report.keepLevel, 2);
  assert.equal(report.population, 103);
  assert.deepEqual(Object.keys(report).sort(), ["army", "buildingCount", "keepLevel", "name", "population", "ruler", "terrain"]);
});

test("raporun yaşı taşınır ve eşiği geçince bayatlar", () => {
  // Keşif kalıcıdır; rapor donmuş bir anlık görüntüdür. Tamamen sönmesi bir
  // denge kararıdır ve Krala bırakıldı, ama yaşı görünmek zorunda.
  const now = 1_800_000_000_000;
  assert.equal(isStaleReport(now - INTEL_REPORT_STALE_MS + 1, now), false);
  assert.equal(isStaleReport(now - INTEL_REPORT_STALE_MS, now), true);
  assert.equal(isStaleReport(now - 7 * 86_400_000, now), true);
});

test("başka channel veya bozuk kayıt dünya listesine sızmaz", () => {
  assert.equal(projectPublicKingdom("user-2", JSON.stringify({ kingdomName: "Uzak", channel: "Başka Dünya" }), "Sınır Boyu"), null);
  assert.equal(projectPublicKingdom("user-3", "bozuk-json", "Sınır Boyu"), null);
});
