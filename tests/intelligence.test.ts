import assert from "node:assert/strict";
import test from "node:test";
import { INTEL_MISSION_RULES, SPY_NETWORK, intelligenceTerms, spyNetworkReportMs, spyNetworkTravelMs } from "../engine/intelligence";
import { deepIntelReportOf, projectPublicKingdom } from "../server/world-projection";
import type { Game } from "../engine/types";

const T0 = 1_800_000_000_000;

function kingdom(overrides: Partial<Game> = {}): Game {
  return {
    version: 2, kingdomName: "Kalendar", rulerName: "Kalen", channel: "Sınır Boyu", channelId: "frontier",
    speed: 4, terrain: "forest", foundedAt: T0, lastTickAt: T0, protectionEndsAt: T0 + 4 * 86_400_000,
    resources: { gold: 91, food: 4200, stone: 20, wood: 30, iron: 4, ale: 0 },
    population: 103, capacity: 150, popularity: 18, reputation: 50, loyalty: 75, taxRate: 15, quota: 6, quotaAt: T0,
    buildings: [{ type: "keep", name: "Kale", category: "Yönetim", level: 2 }],
    units: { spearman: 0 }, queue: null, notices: [], provider: null, model: null, generalConnected: false,
    ...overrides,
  };
}

test("derin gözetleme daha pahalı, daha yavaş ve karşı-istihbarata karşı daha risklidir", () => {
  const plainScout = intelligenceTerms("scout", false);
  const deep = intelligenceTerms("deep_observation", false);
  const defendedDeep = intelligenceTerms("deep_observation", true);
  assert.equal(INTEL_MISSION_RULES.deep_observation.goldCost, 100);
  assert.ok(deep.durationMultiplier > plainScout.durationMultiplier);
  assert.ok(deep.successChance < plainScout.successChance);
  assert.ok(deep.detectionChance > plainScout.detectionChance);
  assert.ok(defendedDeep.successChance < deep.successChance);
  assert.ok(defendedDeep.detectionChance > deep.detectionChance);
});

test("derin rapor yalnız halkın kaba ruh hâlini ekler; rıza puanı ve ambar sızmaz", () => {
  const stored = JSON.stringify(kingdom());
  const publicKingdom = projectPublicKingdom("target", stored, "Sınır Boyu")!;
  const report = deepIntelReportOf(publicKingdom, stored);
  const serialized = JSON.stringify(report);
  assert.equal(report.populaceMood, "İş bırakma");
  assert.ok(!("popularity" in report), "kesin rıza puanı rapora inmemeli");
  assert.ok(!serialized.includes("4200") && !serialized.includes("91"), "ambar ve hazine rakamları rapora inmemeli");
});

test("casus ağı sabit bir bedel, hızdan türeyen yolculuk ve düzenli rapor aralığı kullanır", () => {
  assert.equal(SPY_NETWORK.goldCost, 300);
  assert.equal(SPY_NETWORK.deploymentMinutes, 180);
  assert.equal(SPY_NETWORK.reportHours, 12);
  assert.ok(spyNetworkTravelMs(24) < spyNetworkTravelMs(4));
  assert.ok(spyNetworkReportMs(24) < spyNetworkReportMs(4));
  assert.equal(spyNetworkReportMs(4), 12 * 3_600_000 / 4);
});
