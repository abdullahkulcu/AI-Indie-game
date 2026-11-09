import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../server/war-desk.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../app/api/war/route.ts", import.meta.url), "utf8");

test("saha emri tek bekleyen emir kuralını ve geç kalma durumunu taşır", () => {
  assert.ok(source.includes("export async function issueWarCommand"));
  assert.ok(source.includes("Önceki saha emri henüz orduya ulaşmadı"));
  assert.ok(source.includes("status: \"late\""));
  assert.ok(source.includes("command.kind === \"withdraw\""));
  assert.ok(source.includes("[\"marching\", \"engaged\"]"), "çatışma safhaları arasında da komuta penceresi olmalı");
});

test("çatışma safhaları cron ile ayrı ayrı ilerler ve arayüzde zamanlanır", () => {
  const view = readFileSync(new URL("../components/WarCampaignWorkspace.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("async function advanceBattlePhase"));
  assert.ok(source.includes("eq(wars.status, \"engaged\")"));
  assert.ok(source.includes("battlePhase: war.battlePhase + 1"));
  assert.ok(view.includes("nextBattleAt"));
  assert.ok(view.includes("ÇATIŞMA SAFHASI"));
});

test("savunan yalnız ilan sonrası eğitilen birlikleri takviye hattına ekleyebilir", () => {
  assert.ok(source.includes("export async function reinforceDefender"));
  assert.ok(source.includes("[\"gathering\", \"marching\", \"engaged\"]"));
  assert.ok(source.includes("war.defenderAlertAt > input.now"));
  assert.ok(source.includes("game.units[type]"));
  assert.ok(source.includes("Savunma hattına yeni birlikler katıldı."));
});

test("savunmadaki krallık aynı garnizonla ikinci bir saldırı seferi açamaz", () => {
  assert.ok(routeSource.includes("or(eq(wars.attackerId, user.id), eq(wars.defenderId, user.id))"));
});
