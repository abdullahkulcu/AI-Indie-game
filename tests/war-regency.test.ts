import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { filterRegencyActions, isRegencyDeferredAction } from "../engine/war-regency";

test("naiplik büyük başkent ve diplomasi kararlarını erteler, savunmayı bırakır", () => {
  const result = filterRegencyActions([
    { name: "build_structure", arguments: {} }, { name: "open_negotiation", arguments: {} },
    { name: "trade_resource", arguments: {} }, { name: "set_defense_doctrine", arguments: {} },
  ]);
  assert.deepEqual(result.actions.map(action => action.name), ["trade_resource", "set_defense_doctrine"]);
  assert.deepEqual(result.deferred.map(action => action.name), ["build_structure", "open_negotiation"]);
  assert.match(result.note ?? "", /Hazinedar pazar işlerini/);
});

test("naiplik listesi yalnız tanımlı büyük kararlardan oluşur", () => {
  assert.equal(isRegencyDeferredAction("set_tax_rate"), true);
  assert.equal(isRegencyDeferredAction("set_watch_ratio"), false);
  assert.equal(isRegencyDeferredAction("raise_counter_intelligence"), false);
});

test("General ve Elçilik uçları kralın sefer durumunu denetler", () => {
  const generalRoute = readFileSync(new URL("../app/api/general/route.ts", import.meta.url), "utf8");
  const negotiateRoute = readFileSync(new URL("../app/api/negotiate/route.ts", import.meta.url), "utf8");
  assert.match(generalRoute, /kingIsAwayOnCampaign/);
  assert.match(negotiateRoute, /kingIsAwayOnCampaign/);
  assert.match(negotiateRoute, /row\.warId/);
});
