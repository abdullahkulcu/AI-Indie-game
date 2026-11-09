import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { truceEscalationDelayMs } from "../engine/war";

const desk = readFileSync(new URL("../server/war-desk.ts", import.meta.url), "utf8");
const negotiate = readFileSync(new URL("../app/api/negotiate/route.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("../components/WarCampaignWorkspace.tsx", import.meta.url), "utf8");
const schema = readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");

test("savaş sürerken ateşkes belgesi açılabilir ve seferle kalıcı bağ taşır", () => {
  assert.match(desk, /const peaceableStatuses = \["marching", "engaged", "siege", "blockade", "returning", "resolved"\]/);
  assert.match(desk, /warId: war\.id/);
  assert.match(schema, /warId: text\("war_id"\)/);
  assert.match(view, /ATEŞKES ŞARTI SUN/);
});

test("ateşkes imzası çatışmayı durdurur fakat orduyu dönüş yolundan atlamaz", () => {
  assert.match(desk, /export async function acceptWarTruce/);
  assert.match(desk, /status: "returning", returnsAt/);
  assert.match(desk, /nextBattleAt: null/);
  assert.match(desk, /Ateşkes imzalandı; çatışma durdu/);
  assert.match(negotiate, /acceptWarTruce\(trx, \{ warId: row\.warId, now \}\)/);
});

test("elçi yoldayken tırmanma sınırlı ve rota uzunluğuna bağlı yavaşlar", () => {
  assert.equal(truceEscalationDelayMs(0), 60_000);
  assert.equal(truceEscalationDelayMs(10 * 60_000), 60_000);
  assert.equal(truceEscalationDelayMs(60 * 60_000), 6 * 60_000);
  assert.equal(truceEscalationDelayMs(10 * 60 * 60_000), 20 * 60_000);
  assert.match(desk, /truceEscalationDelayMs/);
  assert.match(desk, /Elçi yoldayken bir sonraki tırmanma safhası kısa süre ertelendi/);
});

test("reddedilen ateşkes daha sonraki şart teklifini kapatmaz", () => {
  assert.match(negotiate, /eq\(wars\.peaceOfferAt, row\.openedAt\)/);
  assert.match(negotiate, /peaceOfferAt: null/);
});
