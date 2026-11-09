import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { passageArrivalAt, supportConvoyTravelMs } from "../engine/march";
import { supportMoraleBonus, warSupportRelationChanges, warSupportReputationChange } from "../engine/war";

test("ikmal konvoyu haberciden yavaş ama ordudan hızlıdır", () => {
  assert.equal(supportConvoyTravelMs(10 * 60_000), 6 * 60_000);
  assert.equal(supportConvoyTravelMs(0), 60_000);
});

test("tek destek konvoyunun moral etkisi sınırlıdır", () => {
  assert.equal(supportMoraleBonus(10), 1);
  assert.equal(supportMoraleBonus(250), 1);
  assert.equal(supportMoraleBonus(251), 2);
  assert.equal(supportMoraleBonus(20_000), 4);
});

test("savaş desteğinin diplomatik itibarı yönüne göre değişir", () => {
  assert.equal(warSupportReputationChange("supply", "defender"), 1);
  assert.equal(warSupportReputationChange("troops", "defender"), 1);
  assert.equal(warSupportReputationChange("supply", "attacker"), -1);
  assert.equal(warSupportReputationChange("passage", "attacker"), -1);
});

test("savaş desteği iki tarafla kalıcı ilişki hafızası oluşturur", () => {
  assert.deepEqual(warSupportRelationChanges("supply", "defender"), { supported: "defender", opposed: "attacker", supportedChange: 8, opposedChange: -8 });
  assert.deepEqual(warSupportRelationChanges("troops", "defender"), { supported: "defender", opposed: "attacker", supportedChange: 12, opposedChange: -12 });
  assert.deepEqual(warSupportRelationChanges("passage", "attacker"), { supported: "attacker", opposed: "defender", supportedChange: 6, opposedChange: -6 });
});

test("geçiş hakkı yalnız kalan rotayı kısaltır ve aynı anda temas yaratmaz", () => {
  assert.equal(passageArrivalAt({ departsAt: 1_000, arrivesAt: 101_000, now: 500, gathering: true }), 86_000);
  assert.equal(passageArrivalAt({ departsAt: 1_000, arrivesAt: 101_000, now: 51_000, gathering: false }), 101_000);
  assert.equal(passageArrivalAt({ departsAt: 1_000, arrivesAt: 1_001, now: 1_000, gathering: false }), 1_001);
});

test("gönüllü destek, kayıpları destekçiye doğru yazar ve sağ kalanları döndürür", () => {
  const desk = readFileSync(new URL("../server/war-desk.ts", import.meta.url), "utf8");
  const api = readFileSync(new URL("../app/api/war/route.ts", import.meta.url), "utf8");
  const view = readFileSync(new URL("../components/WarCampaignWorkspace.tsx", import.meta.url), "utf8");
  assert.match(desk, /sendWarTroops/);
  assert.match(desk, /consumeSupportedDefenderLosses/);
  assert.match(desk, /settleTroopSupportReturns/);
  assert.match(desk, /"marching", "engaged", "siege", "blockade"/);
  assert.match(desk, /kind: "troops"/);
  assert.match(desk, /warSupportReputationChange/);
  assert.match(desk, /recordWarSupportRelations/);
  assert.match(api, /support_troops/);
  assert.match(view, /SAVUNANA BİRLİK GÖNDER/);
});

test("ilişki kaydı Diyar görünümüne sunucudan iner", () => {
  const world = readFileSync(new URL("../app/api/world/route.ts", import.meta.url), "utf8");
  const game = readFileSync(new URL("../components/KingdomGame.tsx", import.meta.url), "utf8");
  assert.match(world, /diplomaticRelations/);
  assert.match(world, /relationByTarget/);
  assert.match(game, /diplomaticStatusFor/);
  assert.match(game, /Dostane/);
  assert.match(game, /Gergin/);
});
