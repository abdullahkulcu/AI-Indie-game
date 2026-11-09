import assert from "node:assert/strict";
import test from "node:test";
import { campaignDurationMs, campaignManpower, campaignSupplyFood, campaignSupplyPlan, campaignTempoMultiplier, courierTravelMs, estimateMarch, gatheringDurationMs } from "../engine/march";
import { counterIntelFreshWindowMs, defendedReputation, defenderAlertAt, peaceTermsForWar, pursuitLossRates, warTargetCooldownMs } from "../engine/war";

test("piyade yürüyüşü hedef arazisinin rota çarpanını ve channel temposunu kullanır", () => {
  const plain = estimateMarch({ from: { x: 0, z: 0 }, to: { x: 30, z: 0 }, units: { spearman: 10 }, targetTerrain: "plain", channelSpeed: 1 });
  const mountain = estimateMarch({ from: { x: 0, z: 0 }, to: { x: 30, z: 0 }, units: { spearman: 10 }, targetTerrain: "mountain", channelSpeed: 24 });
  assert.equal(plain?.gameHours, 30);
  assert.equal(mountain?.gameHours, 276.9230769230769);
  assert.equal(mountain?.durationMs, 41_538_462);
});

test("en yavaş birlik konvoyu belirler; boş ordu yürüyemez", () => {
  const estimate = estimateMarch({ from: { x: 0, z: 0 }, to: { x: 30, z: 0 }, units: { cavalry: 10, siege_team: 1 }, targetTerrain: "plain", channelSpeed: 1 });
  assert.equal(estimate?.slowestSpeed, 3);
  assert.equal(estimate?.gameHours, 60);
  assert.equal(estimateMarch({ from: { x: 0, z: 0 }, to: { x: 1, z: 1 }, units: {}, targetTerrain: "plain", channelSpeed: 1 }), null);
});

test("hazırlık ve ikmal insan gücü ile katalog tüketiminden türer", () => {
  assert.equal(gatheringDurationMs({ spearman: 10 }, 1), 7_200_000);
  assert.equal(gatheringDurationMs({ cavalry: 6, spearman: 4 }, 1), 10_800_000);
  assert.equal(campaignManpower({ cavalry: 2, siege_team: 1 }), 8);
  const plan = campaignSupplyPlan({ units: { spearman: 10 }, oneWayGameHours: 30 });
  assert.deepEqual(plan, {
    oneWayGameHours: 30, battleGameHours: 3,
    outboundFood: 22, battleFood: 3, returnFood: 22,
    baseFood: 47, safetyFood: 10, totalFood: 57,
  });
  assert.equal(campaignSupplyFood({ units: { spearman: 10 }, oneWayGameHours: 30 }), plan.totalFood);
});

test("sefer temposu hızlı channel'da en fazla bir, standart channel'da dört güne yayılır", () => {
  assert.equal(campaignTempoMultiplier(1), 4);
  assert.equal(campaignTempoMultiplier(4), 8);
  assert.equal(campaignTempoMultiplier(24), 24);
  assert.equal(campaignDurationMs(24, 1), 4 * 86_400_000);
  assert.equal(campaignDurationMs(24, 4), 2 * 86_400_000);
  assert.equal(campaignDurationMs(24, 24), 86_400_000);
});

test("hedef dokunulmazlığı channel temposuyla oyun saatine çevrilir", () => {
  assert.equal(warTargetCooldownMs(1), 7_200_000);
  assert.equal(warTargetCooldownMs(24), 300_000);
});

test("taze karşı istihbarat savunanın uyarısını toplanma yerine ilan anına çeker", () => {
  const now = 1_000_000, departsAt = now + 2 * 3_600_000;
  assert.equal(defenderAlertAt(now, departsAt, true), now);
  assert.equal(defenderAlertAt(now, departsAt, false), departsAt);
  assert.equal(counterIntelFreshWindowMs(1), 72 * 3_600_000);
  assert.equal(counterIntelFreshWindowMs(24), 3 * 3_600_000);
});

test("süvari ağırlıklı takip geri çekilene daha çok, takipçiye sınırlı kayıp verir", () => {
  const fast = pursuitLossRates({ cavalry: 8, spearman: 2 }, { spearman: 10 });
  const slow = pursuitLossRates({ spearman: 10 }, { spearman: 10 });
  assert.ok(fast.retreating > slow.retreating);
  assert.ok(fast.pursuer > 0 && fast.pursuer <= .12);
  assert.deepEqual(pursuitLossRates({}, { spearman: 2 }), { retreating: 0, pursuer: 0 });
});

test("başarılı sınır savunması itibar kazandırır ancak tavanı aşmaz", () => {
  assert.equal(defendedReputation(50, true), 53);
  assert.equal(defendedReputation(99, true), 100);
  assert.equal(defendedReputation(50, false), 50);
});

test("haberci ordu yürüyüşünden hızlıdır ama sonucu anında getirmez", () => {
  assert.equal(courierTravelMs(10 * 60_000), 4 * 60_000);
  assert.equal(courierTravelMs(10_000), 60_000);
  assert.equal(courierTravelMs(10 * 60_000), courierTravelMs(10 * 60_000));
});

test("savaş puanı barış belgesine taraf yönü korunarak taşınır", () => {
  const attacker = peaceTermsForWar("initiator", 32);
  assert.equal(attacker.terms.topic, "tribute");
  assert.equal(attacker.terms.payerSide, "target");
  assert.equal(attacker.terms.tributeAmount, 320);
  const defender = peaceTermsForWar("target", -18);
  assert.equal(defender.terms.topic, "tribute");
  assert.equal(defender.terms.payerSide, "initiator");
  assert.equal(defender.terms.tributeAmount, 180);
  assert.equal(peaceTermsForWar("initiator", 0).terms.topic, "non_aggression");
});
