import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { diplomaticRelations, gameSaves, negotiationMessages, negotiations, users, warArmies, warCommands, warEvents, warReports, warSupports, wars } from "../db/schema";
import type { CampaignUnits } from "../engine/march";
import { battlePhaseDurationMs, campaignDurationMs, campaignTempoMultiplier, courierTravelMs, normalizeCampaignUnits, passageArrivalAt, supportConvoyTravelMs } from "../engine/march";
import { BATTLE_PHASES, battleVictor, describeBattlePhase, resolveBattle, resolveBattlePhase, unitsLost } from "../engine/battle";
import { resolveSiege, SIEGE_GAME_HOURS, siegeFoodCost } from "../engine/siege";
import { defendedReputation, KING_LEADS_MORALE_BONUS, kingAbsencePenalty, peaceTermsForWar, pursuitLossRates, supportMoraleBonus, truceEscalationDelayMs, warSupportRelationChanges, warSupportReputationChange, type DefenseDoctrine, type WarApproach, type WarStatus } from "../engine/war";
import { defenderWarAftermath, warDisruptionForDefense, type CivicWarResponse } from "../engine/war-populace";
import { blockadeExperienceSteps, blockadeFoodSpent, blockadeGameHours, blockadeHoursCoveredBySupply, blockadePressureSteps } from "../engine/blockade";
import { rewardBlockadeExperience } from "../engine/units";
import { newId } from "./ids";
import { parseStoredSave } from "./save-validation";
import type { Side } from "../engine/negotiation";

export const ACTIVE_WAR_STATUSES: WarStatus[] = ["gathering", "marching", "engaged", "siege", "blockade", "returning"];
type DbTransaction = Parameters<ReturnType<typeof getDb>["transaction"]>[0] extends (transaction: infer Transaction) => unknown ? Transaction : never;

export function unitsFromStored(value: string): CampaignUnits {
  try { return normalizeCampaignUnits(JSON.parse(value) as Record<string, unknown>); }
  catch { return {}; }
}

export function unitsToStored(units: CampaignUnits): string {
  return JSON.stringify(normalizeCampaignUnits(units));
}

function totalUnits(units: CampaignUnits) {
  return Object.values(units).reduce((sum, amount) => sum + (amount ?? 0), 0);
}

function removeUnits(base: Record<string, number>, losses: CampaignUnits) {
  const next = { ...base };
  for (const [type, amount] of Object.entries(losses)) next[type] = Math.max(0, (next[type] ?? 0) - (amount ?? 0));
  return next;
}

function restoreUnits(base: Record<string, number>, returned: CampaignUnits) {
  const next = { ...base };
  for (const [type, amount] of Object.entries(returned)) next[type] = (next[type] ?? 0) + (amount ?? 0);
  return next;
}

async function changeDiplomaticRelation(trx: DbTransaction, input: { channelId: string; sourceUserId: string; targetUserId: string; change: number }) {
  if (!input.change || input.sourceUserId === input.targetUserId) return;
  const standing = Math.max(-100, Math.min(100, Math.trunc(input.change)));
  await trx.insert(diplomaticRelations).values({
    channelId: input.channelId, sourceUserId: input.sourceUserId, targetUserId: input.targetUserId, standing,
  }).onConflictDoUpdate({
    target: [diplomaticRelations.channelId, diplomaticRelations.sourceUserId, diplomaticRelations.targetUserId],
    set: {
      standing: sql`LEAST(100, GREATEST(-100, ${diplomaticRelations.standing} + ${standing}))`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    },
  });
}

/** Savaş desteği sadece ün değil, destekçinin iki tarafla karşılıklı duruşunu da değiştirir. */
async function recordWarSupportRelations(trx: DbTransaction, input: { channelId: string; supporterId: string; attackerId: string; defenderId: string; kind: "supply" | "troops" | "passage"; side: "attacker" | "defender" }) {
  const change = warSupportRelationChanges(input.kind, input.side);
  const supportedId = change.supported === "attacker" ? input.attackerId : input.defenderId;
  const opposedId = change.opposed === "attacker" ? input.attackerId : input.defenderId;
  await Promise.all([
    changeDiplomaticRelation(trx, { channelId: input.channelId, sourceUserId: input.supporterId, targetUserId: supportedId, change: change.supportedChange }),
    changeDiplomaticRelation(trx, { channelId: input.channelId, sourceUserId: supportedId, targetUserId: input.supporterId, change: change.supportedChange }),
    changeDiplomaticRelation(trx, { channelId: input.channelId, sourceUserId: input.supporterId, targetUserId: opposedId, change: change.opposedChange }),
    changeDiplomaticRelation(trx, { channelId: input.channelId, sourceUserId: opposedId, targetUserId: input.supporterId, change: change.opposedChange }),
  ]);
}

/** Saha kaybını önce gönüllü destek birliklerine yazar; kalan kayıp yerel garnizondandır. */
async function consumeSupportedDefenderLosses(trx: DbTransaction, warId: string, losses: CampaignUnits): Promise<CampaignUnits> {
  const pending: CampaignUnits = { ...losses };
  const supports = await trx.select().from(warSupports).where(and(
    eq(warSupports.warId, warId), eq(warSupports.kind, "troops"), eq(warSupports.status, "delivered"),
  )).orderBy(asc(warSupports.id));
  for (const support of supports) {
    const available = unitsFromStored(support.units);
    const taken: CampaignUnits = {};
    for (const [type, amount] of Object.entries(pending)) {
      const used = Math.min(amount ?? 0, available[type as keyof CampaignUnits] ?? 0);
      if (used > 0) {
        taken[type as keyof CampaignUnits] = used;
        pending[type as keyof CampaignUnits] = Math.max(0, (pending[type as keyof CampaignUnits] ?? 0) - used);
      }
    }
    if (totalUnits(taken)) {
      await trx.update(warSupports).set({ units: unitsToStored(removeUnits(available, taken)) })
        .where(and(eq(warSupports.id, support.id), eq(warSupports.status, "delivered")));
    }
  }
  return pending;
}

function approachOf(value: string): WarApproach {
  return value === "cautious" || value === "intense" ? value : "balanced";
}

function doctrineOf(value: string): DefenseDoctrine {
  return value === "cautious" || value === "hard_response" ? value : "balanced";
}

function moraleOf(game: { loyalty: number; popularity: number; soldierUnrest?: number }) {
  return Math.max(20, Math.min(95, (game.loyalty + game.popularity - (game.soldierUnrest ?? 0)) / 2));
}

function lossLabel(units: CampaignUnits) {
  const count = totalUnits(units);
  return count ? `${count} birlik` : "kayıp yok";
}

type WarLoot = { gold: number; food: number };
const emptyLoot = (): WarLoot => ({ gold: 0, food: 0 });
function lootFromStored(value: string): WarLoot {
  try {
    const valueObject = JSON.parse(value) as Partial<WarLoot>;
    return { gold: Math.max(0, Math.floor(valueObject.gold ?? 0)), food: Math.max(0, Math.floor(valueObject.food ?? 0)) };
  } catch { return emptyLoot(); }
}
function raidLoot(resources: { gold: number; food: number }): WarLoot {
  const share = (amount: number) => Math.max(0, Math.min(Math.floor(amount), Math.floor(amount * .05)));
  return { gold: share(resources.gold), food: share(resources.food) };
}
function lootSummary(loot: WarLoot) {
  const values = [`${loot.gold} altın`, `${loot.food} yiyecek`];
  return loot.gold || loot.food ? values.join(" ve ") : "kaynak yok";
}
function courierArrivalAt(war: { arrivesAt: number; departsAt: number }, now: number) {
  return now + courierTravelMs(Math.max(0, war.arrivesAt - war.departsAt));
}
function buildingLevel(buildings: Array<{ type: string; level: number }>, type: string) {
  return buildings.find(building => building.type === type)?.level ?? 0;
}
function attrition(units: CampaignUnits, rate: number): CampaignUnits {
  const wanted = Math.max(0, Math.floor(totalUnits(units) * rate));
  let remaining = wanted;
  const lost: CampaignUnits = {};
  for (const [type, amount] of Object.entries(units).sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))) {
    const take = Math.min(amount ?? 0, remaining);
    if (take) lost[type as keyof CampaignUnits] = take;
    remaining -= take;
    if (!remaining) break;
  }
  return lost;
}

async function resolveArrival(warId: string, now: number) {
  const db = getDb();
  return db.transaction(async trx => {
    const [war] = await trx.select().from(wars).where(and(eq(wars.id, warId), eq(wars.status, "marching"))).limit(1);
    if (!war) return false;
    const [attackerRow, defenderRow, armies] = await Promise.all([
      trx.select().from(gameSaves).where(eq(gameSaves.userId, war.attackerId)).limit(1),
      trx.select().from(gameSaves).where(eq(gameSaves.userId, war.defenderId)).limit(1),
      trx.select().from(warArmies).where(eq(warArmies.warId, war.id)),
    ]);
    const attackerGame = attackerRow[0] ? parseStoredSave(attackerRow[0].gameState) : null;
    const defenderGame = defenderRow[0] ? parseStoredSave(defenderRow[0].gameState) : null;
    const attackingArmy = armies.find(army => army.side === "attacker");
    const defendingArmy = armies.find(army => army.side === "defender");
    if (!attackerGame || !defenderGame || !attackingArmy || !defendingArmy) return false;
    // Abluka, gizli bir hasar ya da anlık saha savaşı değildir. Ordu sınıra
    // gerçekten ulaşır, garnizondan ayrı kalır ve hedef bunu açıkça görür.
    // Erzak/baskı hesabı bundan sonraki cron turlarında ilerletilir.
    if (war.objective === "blockade") {
      const [moved] = await trx.update(wars).set({ status: "blockade", blockadeSettledAt: now, revision: sql`${wars.revision} + 1` })
        .where(and(eq(wars.id, war.id), eq(wars.status, "marching"))).returning({ id: wars.id });
      if (!moved) return false;
      const reportAt = courierArrivalAt(war, now);
      await trx.insert(warEvents).values({ warId: war.id, sequence: 3, kind: "blockade", message: "Ordu sınır hattına yerleşti; açık abluka baskısı başladı.", at: now, visibleAt: reportAt }).onConflictDoNothing();
      await trx.insert(warReports).values([
        { id: newId("wr"), warId: war.id, userId: war.attackerId, kind: "blockade_started", summary: "Ordu hedef sınırında mevzi aldı. Abluka erzak tükettikçe sürer; bittiğinde kuvvet kendiliğinden döner.", createdAt: now, availableAt: war.kingLeads ? now : reportAt },
        { id: newId("wr"), warId: war.id, userId: war.defenderId, kind: "blockade_started", summary: "Sınır gözcüleri düşman ordusunun açık abluka hattı kurduğunu bildirdi. Nöbeti ve erzağı gözden geçirin; baskı sürdükçe halk huzursuzlaşacak.", createdAt: now, availableAt: reportAt },
      ]).onConflictDoNothing();
      return true;
    }
    const attackerMorale = Math.min(95, moraleOf(attackerGame) + (war.kingLeads ? KING_LEADS_MORALE_BONUS : 0) + war.attackerSupportMorale);
    const defenderMorale = Math.min(95, moraleOf(defenderGame) + war.defenderMoraleBonus + war.defenderSupportMorale);
    const [moved] = await trx.update(wars).set({ status: "engaged", battlePhase: 0, nextBattleAt: now + battlePhaseDurationMs(attackerGame.speed), revision: sql`${wars.revision} + 1` })
      .where(and(eq(wars.id, war.id), eq(wars.status, "marching"))).returning({ id: wars.id });
    if (!moved) return false;
    await trx.update(warArmies).set({ morale: attackerMorale, updatedAt: now }).where(and(eq(warArmies.warId, war.id), eq(warArmies.side, "attacker")));
    await trx.update(warArmies).set({ morale: defenderMorale, updatedAt: now }).where(and(eq(warArmies.warId, war.id), eq(warArmies.side, "defender")));
    const reportAt = courierArrivalAt(war, now);
    await trx.insert(warEvents).values({ warId: war.id, sequence: 3, kind: "contact", message: "Öncüler temas kurdu; atış safhası için mevziler alınıyor.", at: now, visibleAt: reportAt }).onConflictDoNothing();
    await trx.insert(warReports).values([
      { id: newId("wr"), warId: war.id, userId: war.attackerId, kind: "contact", summary: "Öncüler hedef hattında temas kurdu. General ilk çatışma safhası öncesi son düzeni alıyor.", createdAt: now, availableAt: war.kingLeads ? now : reportAt },
      { id: newId("wr"), warId: war.id, userId: war.defenderId, kind: "contact", summary: "Sınır gözcüleri düşman öncülerinin temas kurduğunu bildirdi. İlk çatışma safhası yaklaşıyor.", createdAt: now, availableAt: reportAt },
    ]).onConflictDoNothing();
    return true;
  });
}

/** Tek bir çatışma safhasını işler; safhalar arasına gerçek komuta penceresi bırakır. */
async function advanceBattlePhase(warId: string, now: number) {
  const db = getDb();
  return db.transaction(async trx => {
    // Safhayı daha oyun kayıtlarına dokunmadan sahipleniyoruz. Bu güncelleme
    // satır kilidi aldığı için aynı anda çalışan iki cron veya geri çekilme
    // emri, savunanın kaybını yazıp savaş durumunu yazamama yarışına girmez.
    const [war] = await trx.update(wars).set({ nextBattleAt: null })
      .where(and(eq(wars.id, warId), eq(wars.status, "engaged"), lte(wars.nextBattleAt, now)))
      .returning();
    if (!war) return false;
    const releaseClaim = () => trx.update(wars).set({ nextBattleAt: now + 60_000 })
      .where(and(eq(wars.id, war.id), eq(wars.status, "engaged"), eq(wars.battlePhase, war.battlePhase)));
    const phase = BATTLE_PHASES[war.battlePhase];
    if (!phase) { await releaseClaim(); return false; }
    const [attackerRow, defenderRow, armies] = await Promise.all([
      trx.select().from(gameSaves).where(eq(gameSaves.userId, war.attackerId)).limit(1),
      trx.select().from(gameSaves).where(eq(gameSaves.userId, war.defenderId)).limit(1),
      trx.select().from(warArmies).where(eq(warArmies.warId, war.id)),
    ]);
    const attackerGame = attackerRow[0] ? parseStoredSave(attackerRow[0].gameState) : null;
    const defenderGame = defenderRow[0] ? parseStoredSave(defenderRow[0].gameState) : null;
    const attackerArmy = armies.find(army => army.side === "attacker");
    const defenderArmy = armies.find(army => army.side === "defender");
    if (!attackerGame || !defenderGame || !attackerArmy || !defenderArmy) { await releaseClaim(); return false; }

    const attackerUnits = unitsFromStored(attackerArmy.units), defenderUnits = unitsFromStored(defenderArmy.units);
    const step = resolveBattlePhase({
      seed: `${war.id}:${war.arrivesAt}`,
      phase,
      terrain: war.targetTerrain,
      attacker: { units: attackerUnits, morale: attackerArmy.morale, supplyRatio: attackerArmy.initialSupply ? attackerArmy.supply / attackerArmy.initialSupply : 0 },
      defender: { units: defenderUnits, morale: defenderArmy.morale, supplyRatio: 1 },
      attackerApproach: approachOf(attackerArmy.approach),
      defenderDoctrine: doctrineOf(defenderArmy.approach),
      attackerWithdrawThreshold: attackerArmy.withdrawThreshold,
      defenderWithdrawThreshold: defenderArmy.withdrawThreshold,
    });
    const residentDefenderLosses = await consumeSupportedDefenderLosses(trx, war.id, step.defenderLosses);
    const final = phase === BATTLE_PHASES[BATTLE_PHASES.length - 1] || step.attackerWithdrew || step.defenderWithdrew;
    const victor = battleVictor(step.attacker, step.defender);
    const loot = final && war.objective === "raid" && victor === "attacker" ? raidLoot(defenderGame.resources) : emptyLoot();
    // Abluka bu fonksiyona ulaşmaz; tip daraltması veritabanı durumunu
    // bilemeyeceği için savunma sonrası hesabına yalnız saha amaçlarını veririz.
    const aftermath = defenderWarAftermath({ objective: war.objective === "blockade" ? "raid" : war.objective, defenderUnitsBefore: totalUnits(defenderUnits), defenderLosses: totalUnits(step.defenderLosses), loot, civicResponse: war.defenderCivicResponse as CivicWarResponse, popularity: defenderGame.popularity, factionPressure: defenderGame.factionPressure });
    const defenderWon = victor === "defender";
    const disruption = final ? warDisruptionForDefense({ severity: aftermath.severity, speed: defenderGame.speed, now, previous: defenderGame.warDisruption }) : null;
    const nextDefender = {
      ...defenderGame,
      units: removeUnits(defenderGame.units, residentDefenderLosses),
      resources: final ? { ...defenderGame.resources, gold: defenderGame.resources.gold - loot.gold, food: defenderGame.resources.food - loot.food } : defenderGame.resources,
      // Savaş sürerken de aileler kayıp ve haber baskısını yaşar; yalnız
      // ganimet ve itibar hesabı saha sonucu kesinleştiğinde yazılır.
      popularity: aftermath.popularity,
      factionPressure: aftermath.factionPressure,
      ...(final ? {
        reputation: defendedReputation(defenderGame.reputation, defenderWon),
        warDisruption: disruption!,
      } : {}),
      notices: [{ kind: "SAVAŞ", text: `${describeBattlePhase(step)}${final ? `${defenderWon ? " Savunma hattı üstün geldi." : " Saha sonucu kesinleşti."} Halkta ${aftermath.severity} puanlık savaş sarsıntısı ve şehir üretiminde geçici aksama oluştu.` : " General sonraki safha için düzen alıyor."}`, at: now }, ...defenderGame.notices].slice(0, 20),
    };
    const [savedDefender] = await trx.update(gameSaves).set({ gameState: JSON.stringify(nextDefender), revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(gameSaves.userId, war.defenderId), eq(gameSaves.revision, defenderRow[0].revision))).returning({ userId: gameSaves.userId });
    if (!savedDefender) { await releaseClaim(); return false; }

    const supplyCost = Math.min(attackerArmy.supply, Math.max(1, Math.ceil(attackerArmy.initialSupply * .1)));
    await trx.update(warArmies).set({ units: unitsToStored(step.attacker.units), morale: Math.round(step.attacker.morale), supply: attackerArmy.supply - supplyCost, updatedAt: now })
      .where(and(eq(warArmies.warId, war.id), eq(warArmies.side, "attacker")));
    await trx.update(warArmies).set({ units: unitsToStored(step.defender.units), morale: Math.round(step.defender.morale), updatedAt: now })
      .where(and(eq(warArmies.warId, war.id), eq(warArmies.side, "defender")));

    const nextStatus: "engaged" | "siege" | "returning" = !final ? "engaged" : war.objective === "siege" && victor === "attacker" && totalUnits(step.attacker.units) > 0 ? "siege" : "returning";
    const returnsAt = nextStatus === "returning" ? now + Math.max(60_000, war.arrivesAt - war.departsAt) : null;
    const siegeEndsAt = nextStatus === "siege" ? now + campaignDurationMs(SIEGE_GAME_HOURS, attackerGame.speed) : null;
    const [moved] = await trx.update(wars).set({
      status: nextStatus,
      battlePhase: war.battlePhase + 1,
      nextBattleAt: nextStatus === "engaged" ? now + battlePhaseDurationMs(attackerGame.speed) : null,
      returnsAt, siegeEndsAt,
      ...(final ? { warPoints: victor === "attacker" ? 20 : victor === "defender" ? -20 : 0, outcome: victor, loot: JSON.stringify(loot) } : {}),
      revision: sql`${wars.revision} + 1`,
    }).where(and(eq(wars.id, war.id), eq(wars.status, "engaged"), eq(wars.battlePhase, war.battlePhase))).returning({ id: wars.id });
    if (!moved) { await releaseClaim(); return false; }

    const reportAt = courierArrivalAt(war, now);
    const events = await trx.select({ sequence: warEvents.sequence }).from(warEvents).where(eq(warEvents.warId, war.id));
    await trx.insert(warEvents).values({ warId: war.id, sequence: Math.max(0, ...events.map(event => event.sequence)) + 1, kind: phase, message: describeBattlePhase(step), at: now, visibleAt: reportAt }).onConflictDoNothing();
    const resultText = !final ? "Safha tamamlandı; sonraki sahaya geçilmeden önce emir penceresi açık." : victor === "attacker" ? "Saldıran saha üstünlüğü sağladı." : victor === "defender" ? "Savunma hattı saldırıyı püskürttü." : "Saha savaşı sonuçsuz kaldı.";
    const raidText = final && war.objective === "raid" && victor === "attacker" ? loot.gold || loot.food ? ` Yağma birliği ${lootSummary(loot)} ele geçirdi; ganimet dönüşte ambara katılacak.` : " Yağma birliği hedefte taşınabilir kaynak bulamadı." : "";
    const defenderImpactText = disruption ? ` Şehir üretimi toparlanana kadar %${Math.round(disruption.productionPenalty * 100)} aksayacak.` : "";
    await trx.insert(warReports).values([
      { id: newId("wr"), warId: war.id, userId: war.attackerId, kind: `battle:${war.battlePhase}`, summary: `${describeBattlePhase(step)} ${resultText}${raidText}`, createdAt: now, availableAt: war.kingLeads ? now : reportAt },
      { id: newId("wr"), warId: war.id, userId: war.defenderId, kind: `battle:${war.battlePhase}`, summary: `${describeBattlePhase(step)} ${resultText}${raidText}${defenderImpactText}`, createdAt: now, availableAt: reportAt },
    ]).onConflictDoNothing();
    return true;
  });
}

async function resolveSiegeEnd(warId: string, now: number) {
  const db = getDb();
  return db.transaction(async trx => {
    const [war] = await trx.select().from(wars).where(and(eq(wars.id, warId), eq(wars.status, "siege"), lte(wars.siegeEndsAt, now))).limit(1);
    if (!war) return false;
    const [defenderRow, attackerRow, armies] = await Promise.all([
      trx.select().from(gameSaves).where(eq(gameSaves.userId, war.defenderId)).limit(1),
      trx.select().from(gameSaves).where(eq(gameSaves.userId, war.attackerId)).limit(1),
      trx.select().from(warArmies).where(eq(warArmies.warId, war.id)),
    ]);
    const defender = defenderRow[0] ? parseStoredSave(defenderRow[0].gameState) : null;
    const attacker = attackerRow[0] ? parseStoredSave(attackerRow[0].gameState) : null;
    const attackerArmy = armies.find(army => army.side === "attacker");
    const defenderArmy = armies.find(army => army.side === "defender");
    if (!defender || !attacker || !attackerArmy || !defenderArmy) return false;
    const attackerUnits = unitsFromStored(attackerArmy.units), defenderUnits = unitsFromStored(defenderArmy.units);
    const siegeGameHours = SIEGE_GAME_HOURS * campaignTempoMultiplier(attacker.speed);
    const attackerFoodSpent = Math.min(attackerArmy.supply, siegeFoodCost(attackerUnits, siegeGameHours));
    const attackerSupply = Math.max(0, attackerArmy.supply - attackerFoodSpent);
    const defenderFoodCost = siegeFoodCost(defenderUnits, siegeGameHours);
    const defenderArmyFoodSpent = Math.min(defenderArmy.supply, defenderFoodCost);
    const defenderSupplyRatio = defenderFoodCost > 0 ? Math.min(1, (defenderArmy.supply + defender.resources.food) / defenderFoodCost) : 1;
    const result = resolveSiege({ attacker: attackerUnits, defender: defenderUnits, keepLevel: buildingLevel(defender.buildings, "keep"), wallLevel: buildingLevel(defender.buildings, "wall"), attackerSupplyRatio: attackerArmy.initialSupply ? attackerSupply / attackerArmy.initialSupply : 0, defenderSupplyRatio });
    const attackerLosses = attrition(attackerUnits, result.attackerLossRate);
    const defenderLosses = attrition(defenderUnits, result.defenderLossRate);
    const residentDefenderLosses = await consumeSupportedDefenderLosses(trx, war.id, defenderLosses);
    const nextAttackerUnits = removeUnits(attackerUnits, attackerLosses);
    const nextDefenderUnits = removeUnits(defenderUnits, defenderLosses);
    const loot = result.attackerWon ? raidLoot({ gold: defender.resources.gold, food: defender.resources.food }) : emptyLoot();
    const defenderStoreFoodSpent = Math.min(Math.max(0, defender.resources.food - loot.food), defenderFoodCost - defenderArmyFoodSpent);
    const aftermath = defenderWarAftermath({ objective: "siege", defenderUnitsBefore: totalUnits(defenderUnits), defenderLosses: totalUnits(defenderLosses), loot, civicResponse: war.defenderCivicResponse as CivicWarResponse, popularity: defender.popularity, factionPressure: defender.factionPressure });
    const disruption = warDisruptionForDefense({ severity: aftermath.severity, speed: defender.speed, now, previous: defender.warDisruption });
    const nextDefender = { ...defender, units: removeUnits(defender.units, residentDefenderLosses), resources: { ...defender.resources, gold: defender.resources.gold - loot.gold, food: defender.resources.food - loot.food - defenderStoreFoodSpent }, popularity: aftermath.popularity, factionPressure: aftermath.factionPressure, warDisruption: disruption, notices: [{ kind: "KUŞATMA", text: `Kuşatma sona erdi: ${lossLabel(defenderLosses)} kayıp, ${defenderArmyFoodSpent + defenderStoreFoodSpent} yiyecek kuşatma tüketimi ve ${loot.gold} altın, ${loot.food} yiyecek kaybı oluştu. Halkta ${aftermath.severity} puanlık savaş sarsıntısı ve şehir üretiminde geçici aksama oluştu.`, at: now }, ...defender.notices].slice(0, 20) };
    const [saved] = await trx.update(gameSaves).set({ gameState: JSON.stringify(nextDefender), revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(gameSaves.userId, war.defenderId), eq(gameSaves.revision, defenderRow[0].revision))).returning({ userId: gameSaves.userId });
    if (!saved) return false;
    const [moved] = await trx.update(wars).set({ status: "returning", returnsAt: now + Math.max(60_000, war.arrivesAt - war.departsAt), warPoints: result.attackerWon ? war.warPoints + 30 : war.warPoints - 15, outcome: result.attackerWon ? "attacker" : "defender", loot: JSON.stringify(loot), revision: sql`${wars.revision} + 1` })
      .where(and(eq(wars.id, war.id), eq(wars.status, "siege"))).returning({ id: wars.id });
    if (!moved) return false;
    await trx.update(warArmies).set({ units: unitsToStored(nextAttackerUnits), supply: attackerSupply, updatedAt: now }).where(and(eq(warArmies.warId, war.id), eq(warArmies.side, "attacker")));
    await trx.update(warArmies).set({ units: unitsToStored(nextDefenderUnits), supply: Math.max(0, defenderArmy.supply - defenderArmyFoodSpent), updatedAt: now }).where(and(eq(warArmies.warId, war.id), eq(warArmies.side, "defender")));
    const message = result.attackerWon ? `Kuşatma baskısı sonuç verdi; savunma ${result.progress.toFixed(0)} baskı altında geri çekildi.` : `Kuşatma baskısı kırıldı; savunma tahkimatı dayandı.`;
    // Huruç yapılmışsa olay 8 zaten kullanılmış olabilir. Sıralama yalnızca
    // hikâye için değil, olayın iki kez yazılmaması için de anahtardır.
    const eventRows = await trx.select({ sequence: warEvents.sequence }).from(warEvents).where(eq(warEvents.warId, war.id));
    const nextSequence = Math.max(0, ...eventRows.map(event => event.sequence)) + 1;
    const reportAt = courierArrivalAt(war, now);
    await trx.insert(warEvents).values({ warId: war.id, sequence: nextSequence, kind: "siege_result", message, at: now, visibleAt: reportAt }).onConflictDoNothing();
    await trx.insert(warReports).values([
      { id: newId("wr"), warId: war.id, userId: war.attackerId, kind: "siege", summary: `${message} Sizin kaybınız ${lossLabel(attackerLosses)}; karşı tarafın kaybı ${lossLabel(defenderLosses)}. Kuşatma boyunca ${attackerFoodSpent} yiyecek tükettiniz.`, createdAt: now, availableAt: war.kingLeads ? now : reportAt },
      { id: newId("wr"), warId: war.id, userId: war.defenderId, kind: "siege", summary: `${message} Sizin kaybınız ${lossLabel(defenderLosses)}; karşı tarafın kaybı ${lossLabel(attackerLosses)}. Garnizon ve şehir ${defenderArmyFoodSpent + defenderStoreFoodSpent} yiyecek tüketti; şehir üretimi toparlanana kadar %${Math.round(disruption.productionPenalty * 100)} aksayacak.`, createdAt: now, availableAt: reportAt },
    ]).onConflictDoNothing();
    return true;
  });
}

/**
 * Kuşatılmış garnizonun, Kralın mührüyle yaptığı tek huruç. Huruç yeni bir
 * ordu yaratmaz: ilk temasta kayda alınmış savunma kuvvetiyle, kuşatan orduya
 * karşı ikinci bir saha çatışmasıdır. Savunan kazanırsa kuşatma kalkar;
 * saldıran kazanırsa kuşatma sürer fakat iki taraf da ek kayıp verir.
 */
export async function sallyFromSiege(input: { warId: string; userId: string; now: number }) {
  const db = getDb();
  try {
    return await db.transaction(async trx => {
    const [war] = await trx.select().from(wars).where(and(eq(wars.id, input.warId), eq(wars.status, "siege"))).limit(1);
    if (!war) return { ok: false as const, status: 409, error: "Huruç yalnız etkin bir kuşatma sırasında verilebilir." };
    if (war.defenderId !== input.userId) return { ok: false as const, status: 403, error: "Huruç emrini yalnız kuşatılan krallığın Kralı verebilir." };

    const previous = await trx.select({ sequence: warEvents.sequence }).from(warEvents).where(eq(warEvents.warId, war.id));

    const [attackerRow, defenderRow, armies] = await Promise.all([
      trx.select().from(gameSaves).where(eq(gameSaves.userId, war.attackerId)).limit(1),
      trx.select().from(gameSaves).where(eq(gameSaves.userId, war.defenderId)).limit(1),
      trx.select().from(warArmies).where(eq(warArmies.warId, war.id)),
    ]);
    const attackerGame = attackerRow[0] ? parseStoredSave(attackerRow[0].gameState) : null;
    const defenderGame = defenderRow[0] ? parseStoredSave(defenderRow[0].gameState) : null;
    const attackingArmy = armies.find(army => army.side === "attacker");
    const defendingArmy = armies.find(army => army.side === "defender");
    if (!attackerGame || !defenderGame || !attackingArmy || !defendingArmy) return { ok: false as const, status: 409, error: "Kuşatma kuvvetleri okunamadı; defteri yenileyin." };

    const attackerUnits = unitsFromStored(attackingArmy.units);
    const defenderUnits = unitsFromStored(defendingArmy.units);
    if (!totalUnits(attackerUnits) || !totalUnits(defenderUnits)) return { ok: false as const, status: 409, error: "Huruç yapacak etkin birlik kalmadı." };
    // Aynı Kralın iki sekmesi veya iki eşzamanlı istek, aynı huruç kaybını iki
    // kez yazamaz. Bu koşullu güncelleme yarışı veritabanında kapatır.
    const [claimed] = await trx.update(wars).set({ sallyAt: input.now })
      .where(and(eq(wars.id, war.id), eq(wars.status, "siege"), isNull(wars.sallyAt)))
      .returning({ id: wars.id });
    if (!claimed) return { ok: false as const, status: 409, error: "Bu kuşatmada huruç emri zaten işlendi veya kuşatma sonuçlandı." };
    const result = resolveBattle({
      seed: `${war.id}:sally:${war.revision}`,
      terrain: war.targetTerrain,
      attacker: { units: attackerUnits, morale: Math.min(95, moraleOf(attackerGame) + (war.kingLeads ? KING_LEADS_MORALE_BONUS : 0) + war.attackerSupportMorale), supplyRatio: attackingArmy.initialSupply ? attackingArmy.supply / attackingArmy.initialSupply : 0 },
      defender: { units: defenderUnits, morale: Math.min(95, moraleOf(defenderGame) + war.defenderMoraleBonus + war.defenderSupportMorale), supplyRatio: 1 },
      // Sert karşılık, savunanın kaleden çıkarma riskini temsil eder. Huruç
      // yine de arazi ve kuşatanın kalan ikmaliyle dengelenir.
      attackerApproach: approachOf(attackingArmy.approach),
      defenderDoctrine: "hard_response",
      attackerWithdrawThreshold: attackingArmy.withdrawThreshold,
      defenderWithdrawThreshold: 35,
    });
    const attackerLosses = unitsLost(attackerUnits, result.attacker.units);
    const defenderLosses = unitsLost(defenderUnits, result.defender.units);
    const residentDefenderLosses = await consumeSupportedDefenderLosses(trx, war.id, defenderLosses);
    const defenderWon = result.victor === "defender";
    const nextDefender = {
      ...defenderGame,
      units: removeUnits(defenderGame.units, residentDefenderLosses),
      reputation: defendedReputation(defenderGame.reputation, defenderWon),
      notices: [{ kind: "HURUÇ", text: `Kuşatma altında huruç yapıldı; ${lossLabel(defenderLosses)} kayıp verildi.${defenderWon ? " Kuşatma hattını yararak itibar kazandınız." : ""}`, at: input.now }, ...defenderGame.notices].slice(0, 20),
    };
    const [saved] = await trx.update(gameSaves).set({ gameState: JSON.stringify(nextDefender), revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(gameSaves.userId, war.defenderId), eq(gameSaves.revision, defenderRow[0].revision))).returning({ userId: gameSaves.userId });
    if (!saved) throw new Error("Garnizon kaydı huruç sırasında değişti.");

    const attackerSupply = Math.max(0, attackingArmy.supply - Math.max(1, Math.ceil(attackingArmy.initialSupply * .15)));
    const status = defenderWon ? "returning" : "siege";
    const returnsAt = defenderWon ? input.now + Math.max(60_000, war.arrivesAt - war.departsAt) : null;
    const [moved] = await trx.update(wars).set({
      status, returnsAt,
      warPoints: defenderWon ? war.warPoints - 25 : war.warPoints + 10,
      outcome: defenderWon ? "defender" : "attacker",
      revision: sql`${wars.revision} + 1`,
    }).where(and(eq(wars.id, war.id), eq(wars.status, "siege"))).returning({ id: wars.id });
    if (!moved) throw new Error("Kuşatma huruç sırasında sonuçlandı.");
    await trx.update(warArmies).set({ units: unitsToStored(result.attacker.units), supply: attackerSupply, updatedAt: input.now }).where(and(eq(warArmies.warId, war.id), eq(warArmies.side, "attacker")));
    await trx.update(warArmies).set({ units: unitsToStored(result.defender.units), updatedAt: input.now }).where(and(eq(warArmies.warId, war.id), eq(warArmies.side, "defender")));
    const sequence = Math.max(0, ...previous.map(event => event.sequence)) + 1;
    const message = defenderWon
      ? "Garnizon huruçla kuşatma hattını yardı; kuşatan ordu geri çekiliyor."
      : "Garnizon huruç denedi fakat kuşatma hattı dayandı; baskı sürüyor.";
    // Huruç emri saraydan çıkabilir; ancak iki ordunun gerçek kayıp ve sonucu
    // Kral'a ancak bir haberci döndüğünde ulaşır.
    const reportAt = courierArrivalAt(war, input.now);
    await trx.insert(warEvents).values({ warId: war.id, sequence, kind: "sally", message, at: input.now, visibleAt: reportAt }).onConflictDoNothing();
    await trx.insert(warReports).values([
      { id: newId("wr"), warId: war.id, userId: war.attackerId, kind: "sally", summary: `${message} Siz ${lossLabel(attackerLosses)}; karşı taraf ${lossLabel(defenderLosses)} verdi.`, createdAt: input.now, availableAt: war.kingLeads ? input.now : reportAt },
      { id: newId("wr"), warId: war.id, userId: war.defenderId, kind: "sally", summary: `${message} Siz ${lossLabel(defenderLosses)}; karşı taraf ${lossLabel(attackerLosses)} verdi.`, createdAt: input.now, availableAt: reportAt },
    ]).onConflictDoNothing();
    return { ok: true as const, returned: defenderWon, returnsAt };
    });
  } catch {
    // Transaction atılır; sally_at, kayıp ve olay aynı anda geri alınır.
    return { ok: false as const, status: 409, error: "Huruç uygulanırken kayıt değişti; savaş defterini yenileyin." };
  }
}

/** Savunanın geri çekilen orduya yapabildiği tek, sınırlı takip harekâtı. */
export async function pursueReturningArmy(input: { warId: string; userId: string; now: number }) {
  const db = getDb();
  try {
    return await db.transaction(async trx => {
      const [war] = await trx.select().from(wars).where(and(eq(wars.id, input.warId), eq(wars.status, "returning"))).limit(1);
      if (!war) return { ok: false as const, status: 409, error: "Takip yalnız geri çekilen etkin bir orduya yapılabilir." };
      if (war.defenderId !== input.userId) return { ok: false as const, status: 403, error: "Takip emrini yalnız savunan Kral verebilir." };
      if (war.defenderAlertAt > input.now) return { ok: false as const, status: 409, error: "Sınır tehdidi henüz teyit edilmedi." };
      if (war.outcome !== "defender") return { ok: false as const, status: 409, error: "Takip, ancak savunma zaferiyle geri çekilen orduya karşı verilebilir." };
      const [pendingReport] = await trx.select({ id: warReports.id }).from(warReports)
        .where(and(eq(warReports.warId, war.id), eq(warReports.userId, input.userId), gt(warReports.availableAt, input.now))).limit(1);
      if (pendingReport) return { ok: false as const, status: 409, error: "Saha sonucunu teyit eden haberciniz henüz saraya ulaşmadı." };
      const [claimed] = await trx.update(wars).set({ pursuitAt: input.now })
        .where(and(eq(wars.id, war.id), eq(wars.status, "returning"), isNull(wars.pursuitAt)))
        .returning({ id: wars.id });
      if (!claimed) return { ok: false as const, status: 409, error: "Bu orduya takip emri zaten verildi veya ordu sınıra ulaştı." };
      const [[attackerArmy], [defenderArmy], [defenderRow]] = await Promise.all([
        trx.select().from(warArmies).where(and(eq(warArmies.warId, war.id), eq(warArmies.side, "attacker"))).limit(1),
        trx.select().from(warArmies).where(and(eq(warArmies.warId, war.id), eq(warArmies.side, "defender"))).limit(1),
        trx.select().from(gameSaves).where(eq(gameSaves.userId, war.defenderId)).limit(1),
      ]);
      const defenderGame = defenderRow ? parseStoredSave(defenderRow.gameState) : null;
      if (!attackerArmy || !defenderArmy || !defenderGame) throw new Error("Saha kuvveti okunamadı");
      const attackers = unitsFromStored(attackerArmy.units), defenders = unitsFromStored(defenderArmy.units);
      const rates = pursuitLossRates(defenders, attackers);
      if (!rates.retreating) return { ok: false as const, status: 409, error: "Takip yapacak etkin birlik kalmadı." };
      const attackerLosses = attrition(attackers, rates.retreating);
      const defenderLosses = attrition(defenders, rates.pursuer);
      const residentDefenderLosses = await consumeSupportedDefenderLosses(trx, war.id, defenderLosses);
      const nextAttackers = removeUnits(attackers, attackerLosses);
      const nextDefenders = removeUnits(defenders, defenderLosses);
      const nextDefenderGame = { ...defenderGame, units: removeUnits(defenderGame.units, residentDefenderLosses), notices: [{ kind: "TAKİP", text: `Geri çekilen ordu takip edildi; ${lossLabel(defenderLosses)} kayıp verildi.`, at: input.now }, ...defenderGame.notices].slice(0, 20) };
      const [saved] = await trx.update(gameSaves).set({ gameState: JSON.stringify(nextDefenderGame), revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(gameSaves.userId, war.defenderId), eq(gameSaves.revision, defenderRow.revision))).returning({ userId: gameSaves.userId });
      if (!saved) throw new Error("Garnizon kaydı değişti");
      await trx.update(warArmies).set({ units: unitsToStored(nextAttackers), updatedAt: input.now }).where(and(eq(warArmies.warId, war.id), eq(warArmies.side, "attacker")));
      await trx.update(warArmies).set({ units: unitsToStored(nextDefenders), updatedAt: input.now }).where(and(eq(warArmies.warId, war.id), eq(warArmies.side, "defender")));
      await trx.update(wars).set({ warPoints: war.warPoints - 8, revision: sql`${wars.revision} + 1` }).where(eq(wars.id, war.id));
      const events = await trx.select({ sequence: warEvents.sequence }).from(warEvents).where(eq(warEvents.warId, war.id));
      const reportAt = courierArrivalAt(war, input.now);
      const message = `Savunanın takip birliği geri çekilen orduya vurdu; saldıran ${lossLabel(attackerLosses)}, savunan ${lossLabel(defenderLosses)} verdi.`;
      await trx.insert(warEvents).values({ warId: war.id, sequence: Math.max(0, ...events.map(event => event.sequence)) + 1, kind: "pursuit", message, at: input.now, visibleAt: reportAt }).onConflictDoNothing();
      await trx.insert(warReports).values([
        { id: newId("wr"), warId: war.id, userId: war.defenderId, kind: "pursuit", summary: message, createdAt: input.now, availableAt: input.now },
        { id: newId("wr"), warId: war.id, userId: war.attackerId, kind: "pursuit", summary: message, createdAt: input.now, availableAt: war.kingLeads ? input.now : reportAt },
      ]).onConflictDoNothing();
      return { ok: true as const, attackerLosses, defenderLosses };
    });
  } catch {
    return { ok: false as const, status: 409, error: "Takip emri uygulanırken savaş kaydı değişti; defteri yenileyin." };
  }
}

/**
 * Savaş sonucu ancak Kralın imzaladığı gerçek bir elçilik belgesine dönüşür.
 * Puan saldıran lehineyse karşı tarafın haraç ödemesi, savunan lehineyse
 * saldıranın bedel ödemesi önerilir; başa baş sonuç yalnız ateşkes önerir.
 */
export async function offerWarPeace(input: { warId: string; userId: string; now: number }) {
  const db = getDb();
  return db.transaction(async trx => {
    const [war] = await trx.select().from(wars).where(eq(wars.id, input.warId)).limit(1);
    if (!war) return { ok: false as const, status: 404, error: "Savaş kaydı bulunamadı." };
    const side: Side | null = war.attackerId === input.userId ? "initiator" : war.defenderId === input.userId ? "target" : null;
    if (!side) return { ok: false as const, status: 403, error: "Bu savaşta tarafınız yok." };
    const peaceableStatuses = ["marching", "engaged", "siege", "blockade", "returning", "resolved"] as const;
    if (!(peaceableStatuses as readonly string[]).includes(war.status)) return { ok: false as const, status: 409, error: "Ateşkes belgesi ordu yürüyüşe geçtikten sonra sunulabilir." };
    const [pendingCourier] = await trx.select({ id: warReports.id }).from(warReports)
      .where(and(eq(warReports.warId, war.id), eq(warReports.userId, input.userId), gt(warReports.availableAt, input.now)))
      .limit(1);
    if (pendingCourier) return { ok: false as const, status: 409, error: "Saha haberi henüz saraya ulaşmadı; barış şartı için habercinizi bekleyin." };
    // Savaş bittikten sonra iki taraf da belgeyi aynı anda açmaya çalışabilir.
    // Belgeyi/mesajı yazmadan önce savaşı koşullu mühürlüyoruz; böylece iki
    // ayrı masaya aynı savaş puanı taşınmaz.
    const finalResult = war.status === "returning" || war.status === "resolved";
    const truceDelay = truceEscalationDelayMs(Math.max(0, war.arrivesAt - war.departsAt));
    const delayedEscalationAt = war.status === "engaged" && war.nextBattleAt !== null
      ? Math.max(input.now, war.nextBattleAt) + truceDelay
      : war.status === "siege" && war.siegeEndsAt !== null
        ? Math.max(input.now, war.siegeEndsAt) + truceDelay
        : null;
    const [claimed] = await trx.update(wars).set({
      peaceOfferAt: input.now,
      ...(war.status === "engaged" ? { nextBattleAt: delayedEscalationAt } : {}),
      ...(war.status === "siege" ? { siegeEndsAt: delayedEscalationAt } : {}),
      revision: sql`${wars.revision} + 1`,
    })
      .where(and(eq(wars.id, war.id), inArray(wars.status, peaceableStatuses), isNull(wars.peaceOfferAt)))
      .returning({ id: wars.id });
    if (!claimed) return { ok: false as const, status: 409, error: "Bu savaş için zaten bir barış belgesi açıldı veya sefer durumu değişti." };
    const { terms } = peaceTermsForWar(side, war.warPoints);
    const topic = terms.topic;
    const id = newId("ng");
    const message = finalResult
      ? topic === "tribute"
        ? `Saha sonucundaki ${Math.abs(war.warPoints)} savaş puanına dayanarak ateşkes ve sınırlı haraç şartımızı sunuyoruz.`
        : "Savaş belirleyici bir üstünlük üretmedi. Yirmi dört saatlik saldırmazlıkla yaraları sarmayı öneriyoruz."
      : "Saha sürerken ateşkes öneriyoruz. Şart kabul edilirse iki ordu da geri dönüşe geçecek.";
    await trx.insert(negotiations).values({
      id, channelId: war.channelId, warId: war.id, initiatorId: war.attackerId, targetId: war.defenderId, topic,
      status: "awaiting_king", turns: 1, proposed: JSON.stringify(terms), proposedBy: side,
      openedAt: input.now, expiresAt: input.now + 12 * 3_600_000, lastTurnAt: input.now,
    });
    await trx.insert(negotiationMessages).values({ id: newId("nm"), negotiationId: id, side, speaker: "king", body: message, at: input.now });
    const events = await trx.select({ sequence: warEvents.sequence }).from(warEvents).where(eq(warEvents.warId, war.id));
    const sequence = Math.max(0, ...events.map(event => event.sequence)) + 1;
    await trx.insert(warEvents).values({ warId: war.id, sequence, kind: "peace_offer", message: finalResult ? "Savaş puanı elçilik belgesine taşındı; karşı Kralın mührü bekleniyor." : `Saha ateşkesi elçilik belgesine taşındı; karşı Kralın mührü bekleniyor.${delayedEscalationAt ? " Elçi yoldayken bir sonraki tırmanma safhası kısa süre ertelendi." : ""}`, at: input.now }).onConflictDoNothing();
    await trx.insert(warReports).values([
      { id: newId("wr"), warId: war.id, userId: war.attackerId, kind: "peace", summary: finalResult ? "Savaş sonucu için bağlayıcı barış belgesi açıldı; şartın imzası karşı Kralı bekliyor." : "Saha ateşkesi için bağlayıcı belge açıldı; kabul edilirse ordu geri dönecek.", createdAt: input.now },
      { id: newId("wr"), warId: war.id, userId: war.defenderId, kind: "peace", summary: finalResult ? "Savaş sonucuna ilişkin bir barış şartı geldi; Elçilik Masası'nda kabul veya ret mührünüzü bekliyor." : "Saha ateşkesi için bir şart geldi; kabul edilirse iki ordu geri dönüşe geçecek.", createdAt: input.now },
    ]).onConflictDoNothing();
    return { ok: true as const, negotiationId: id };
  });
}

/**
 * Elçilik Masası'nda imzalanan saha ateşkesi. İmza orduları ışınlamaz:
 * çatışmayı durdurur, saldıran kuvveti gerçek dönüş yoluna bırakır. Böylece
 * aynı savaşın birlikleri ne iki kez garnizona yazılır ne de cron yeni bir
 * çatışma safhası çözebilir.
 */
export async function acceptWarTruce(trx: DbTransaction, input: { warId: string; now: number }) {
  const [war] = await trx.select().from(wars).where(eq(wars.id, input.warId)).limit(1);
  if (!war) return { ok: false as const, error: "Ateşkese bağlı sefer bulunamadı." };
  if (war.status === "returning" || war.status === "resolved") return { ok: true as const, returning: war.status === "returning" };
  if (!(["marching", "engaged", "siege", "blockade"] as string[]).includes(war.status)) return { ok: false as const, error: "Sefer artık ateşkes koşulunu uygulayabilecek durumda değil." };
  const returnsAt = input.now + Math.max(60_000, war.arrivesAt - war.departsAt);
  const [moved] = await trx.update(wars).set({
    status: "returning", returnsAt, nextBattleAt: null, siegeEndsAt: null, outcome: "draw", revision: sql`${wars.revision} + 1`,
  }).where(and(eq(wars.id, war.id), inArray(wars.status, ["marching", "engaged", "siege", "blockade"]))).returning({ id: wars.id });
  if (!moved) return { ok: false as const, error: "Sefer durumu imza sırasında değişti; şartı yeniden açın." };
  const events = await trx.select({ sequence: warEvents.sequence }).from(warEvents).where(eq(warEvents.warId, war.id));
  const sequence = Math.max(0, ...events.map(event => event.sequence)) + 1;
  const reportAt = courierArrivalAt(war, input.now);
  await trx.insert(warEvents).values({ warId: war.id, sequence, kind: "truce", message: "Ateşkes imzalandı; çatışma durdu ve saldıran ordu dönüş yoluna çıktı.", at: input.now, visibleAt: reportAt }).onConflictDoNothing();
  await trx.insert(warReports).values([
    { id: newId("wr"), warId: war.id, userId: war.attackerId, kind: "truce", summary: "Ateşkes imzalandı. Çatışma durdu; ordu gerçek dönüş yoluna geçti.", createdAt: input.now, availableAt: war.kingLeads ? input.now : reportAt },
    { id: newId("wr"), warId: war.id, userId: war.defenderId, kind: "truce", summary: "Ateşkes imzalandı. Sınırdaki çatışma durdu; saldıran ordu geri dönüyor.", createdAt: input.now, availableAt: reportAt },
  ]).onConflictDoNothing();
  return { ok: true as const, returning: true };
}

async function settleReturn(warId: string, now: number) {
  const db = getDb();
  return db.transaction(async trx => {
    const [war] = await trx.select().from(wars).where(and(eq(wars.id, warId), eq(wars.status, "returning"), lte(wars.returnsAt, now))).limit(1);
    if (!war) return false;
    const [sourceRow, army] = await Promise.all([
      trx.select().from(gameSaves).where(eq(gameSaves.userId, war.attackerId)).limit(1),
      trx.select().from(warArmies).where(and(eq(warArmies.warId, war.id), eq(warArmies.side, "attacker"))).limit(1),
    ]);
    const source = sourceRow[0] ? parseStoredSave(sourceRow[0].gameState) : null;
    if (!source || !army[0]) return false;
    const returnedUnits = unitsFromStored(army[0].units);
    const loot = lootFromStored(war.loot);
    const elapsedGameHours = (now - war.departsAt) * Math.max(1, source.speed) / 3_600_000;
    const absencePenalty = kingAbsencePenalty(war.kingLeads, elapsedGameHours);
    const absenceLine = absencePenalty ? ` Kralın uzun seferi başkentte ${absencePenalty} rıza kaybı doğurdu.` : "";
    const next = { ...source, units: restoreUnits(source.units, returnedUnits), resources: { ...source.resources, food: source.resources.food + army[0].supply + loot.food, gold: source.resources.gold + loot.gold }, popularity: Math.max(0, source.popularity - absencePenalty), notices: [{ kind: "SEFER", text: `Sefer kuvveti döndü; ${totalUnits(returnedUnits)} birlik, kalan ${army[0].supply} yiyecek ve ${loot.gold} altın ganimet ambara katıldı.${absenceLine}`, at: now }, ...source.notices].slice(0, 20) };
    const [saved] = await trx.update(gameSaves)
      .set({ gameState: JSON.stringify(next), revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(gameSaves.userId, war.attackerId), eq(gameSaves.revision, sourceRow[0].revision)))
      .returning({ userId: gameSaves.userId });
    if (!saved) return false;
    const [resolved] = await trx.update(wars).set({ status: "resolved", resolvedAt: now, revision: sql`${wars.revision} + 1` })
      .where(and(eq(wars.id, war.id), eq(wars.status, "returning"))).returning({ id: wars.id });
    if (!resolved) return false;
    const events = await trx.select({ sequence: warEvents.sequence }).from(warEvents).where(eq(warEvents.warId, war.id));
    await trx.insert(warEvents).values({ warId: war.id, sequence: Math.max(0, ...events.map(event => event.sequence)) + 1, kind: "return", message: "Sefer kuvveti başkente döndü.", at: now }).onConflictDoNothing();
    await trx.insert(warReports).values([
      { id: newId("wr"), warId: war.id, userId: war.attackerId, kind: "return", summary: `Sefer sona erdi; hayatta kalan birlikler garnizon düzenine geri döndü. Kalan ${army[0].supply} yiyecek ile ${lootSummary(loot)} ambara katıldı.`, createdAt: now },
      { id: newId("wr"), warId: war.id, userId: war.defenderId, kind: "return", summary: "Saldıran sefer kuvveti geri döndü; sınırdaki acil durum sona erdi.", createdAt: now },
    ]).onConflictDoNothing();
    return true;
  });
}

export async function issueWarCommand(input: { warId: string; userId: string; kind: "advance" | "hold" | "withdraw"; now: number }) {
  const db = getDb();
  return db.transaction(async trx => {
    const [war] = await trx.select().from(wars).where(and(eq(wars.id, input.warId), eq(wars.attackerId, input.userId))).limit(1);
    if (!war) return { ok: false as const, status: 404, error: "Bu sefer için komuta yetkiniz yok." };
    if (!(["marching", "engaged"] as string[]).includes(war.status)) return { ok: false as const, status: 409, error: "Saha emri yalnız yürüyüşte veya çatışma safhaları arasındayken gönderilebilir." };
    const [pending] = await trx.select({ id: warCommands.id }).from(warCommands)
      .where(and(eq(warCommands.warId, war.id), eq(warCommands.issuerId, input.userId), eq(warCommands.status, "en_route"))).limit(1);
    if (pending) return { ok: false as const, status: 409, error: "Önceki saha emri henüz orduya ulaşmadı." };
    const arrivesAt = war.kingLeads ? input.now : input.now + courierTravelMs(Math.max(0, war.arrivesAt - war.departsAt));
    const id = newId("wc");
    await trx.insert(warCommands).values({ id, warId: war.id, issuerId: input.userId, kind: input.kind, sentAt: input.now, arrivesAt });
    const names = { advance: "İlerleme", hold: "Mevzide kalma", withdraw: "Geri çekilme" } as const;
    await trx.insert(warReports).values({ id: newId("wr"), warId: war.id, userId: input.userId, kind: `command_departure:${id}`, summary: `${names[input.kind]} emri ${war.kingLeads ? "cephede derhal uygulanmak üzere" : "haberciyle"} yola çıktı.`, createdAt: input.now });
    return { ok: true as const, arrivesAt };
  });
}

async function advanceWarCommands(now: number) {
  const db = getDb();
  let transitioned = 0;
  const due = await db.select().from(warCommands).where(and(eq(warCommands.status, "en_route"), lte(warCommands.arrivesAt, now)));
  for (const command of due) {
    const applied = await db.transaction(async trx => {
      const [current, war] = await Promise.all([
        trx.select().from(warCommands).where(and(eq(warCommands.id, command.id), eq(warCommands.status, "en_route"))).limit(1),
        trx.select().from(wars).where(eq(wars.id, command.warId)).limit(1),
      ]);
      if (!current[0]) return false;
      if (!war[0] || !(["marching", "engaged"] as string[]).includes(war[0].status)) {
        await trx.update(warCommands).set({ status: "late", appliedAt: now }).where(and(eq(warCommands.id, command.id), eq(warCommands.status, "en_route")));
        await trx.insert(warReports).values({ id: newId("wr"), warId: command.warId, userId: command.issuerId, kind: `command_late:${command.id}`, summary: "Saha emri orduya ulaştığında çatışma veya dönüş başlamıştı; emir uygulanamadı.", createdAt: now });
        return true;
      }
      const [claimed] = await trx.update(warCommands).set({ status: "applied", appliedAt: now })
        .where(and(eq(warCommands.id, command.id), eq(warCommands.status, "en_route"))).returning({ id: warCommands.id });
      if (!claimed) return false;
      const label = command.kind === "advance" ? "İlerleme emri" : command.kind === "hold" ? "Mevzide kalma emri" : "Geri çekilme emri";
      if (command.kind === "withdraw") {
        const [moved] = await trx.update(wars).set({ status: "returning", returnsAt: now + Math.max(60_000, war[0].arrivesAt - war[0].departsAt), revision: sql`${wars.revision} + 1` })
          .where(and(eq(wars.id, war[0].id), inArray(wars.status, ["marching", "engaged"]))).returning({ id: wars.id });
        if (!moved) {
          await trx.update(warCommands).set({ status: "late" }).where(eq(warCommands.id, command.id));
          await trx.insert(warReports).values({ id: newId("wr"), warId: war[0].id, userId: command.issuerId, kind: `command_late:${command.id}`, summary: "Geri çekilme emri sahaya ulaştığında sefer durumu değişmişti; emir uygulanamadı.", createdAt: now });
          return true;
        }
      } else {
        await trx.update(warArmies).set({ approach: command.kind === "advance" ? "intense" : "cautious", updatedAt: now })
          .where(and(eq(warArmies.warId, war[0].id), eq(warArmies.side, "attacker")));
      }
      const events = await trx.select({ sequence: warEvents.sequence }).from(warEvents).where(eq(warEvents.warId, war[0].id));
      await trx.insert(warEvents).values({ warId: war[0].id, sequence: Math.max(0, ...events.map(event => event.sequence)) + 1, kind: "command", message: `${label} sahadaki General tarafından uygulandı.`, at: now }).onConflictDoNothing();
      await trx.insert(warReports).values({ id: newId("wr"), warId: war[0].id, userId: command.issuerId, kind: `command_applied:${command.id}`, summary: `${label} orduya ulaştı ve uygulandı.`, createdAt: now });
      return true;
    });
    if (applied) transitioned++;
  }
  return transitioned;
}

/** Tarafsız Kralın erzak konvoyu: yardım yola çıkar, zamanında varırsa orduyu besler. */
export async function sendWarSupply(input: { warId: string; userId: string; channelId: string; side: "attacker" | "defender"; food: number; now: number }) {
  const db = getDb();
  const food = Math.floor(input.food);
  if (!Number.isFinite(food) || food < 10) return { ok: false as const, status: 400, error: "İkmal konvoyu için en az 10 yiyecek gerekir." };
  return db.transaction(async trx => {
    const [war, supporterRow] = await Promise.all([
      trx.select().from(wars).where(eq(wars.id, input.warId)).limit(1),
      trx.select().from(gameSaves).where(eq(gameSaves.userId, input.userId)).limit(1),
    ]);
    const target = war[0];
    const supporter = supporterRow[0] ? parseStoredSave(supporterRow[0].gameState) : null;
    if (!target || target.channelId !== input.channelId) return { ok: false as const, status: 404, error: "Destek verilecek sefer bulunamadı." };
    if (!ACTIVE_WAR_STATUSES.includes(target.status)) return { ok: false as const, status: 409, error: "Bu sefer artık ikmal kabul etmiyor." };
    if (target.attackerId === input.userId || target.defenderId === input.userId) return { ok: false as const, status: 403, error: "Kendi seferinize dış destek gönderemezsiniz; ikmali Sefer Masası'ndan yönetirsiniz." };
    if (!supporter || supporter.resources.food < food) return { ok: false as const, status: 409, error: "Ambarda gönderilecek kadar yiyecek yok." };
    const maximum = Math.max(10, Math.floor(supporter.resources.food * .5));
    if (food > maximum) return { ok: false as const, status: 400, error: `Bir konvoyda ambarın en fazla ${maximum} yiyeceği gönderilebilir.` };
    const id = newId("ws");
    const arrivesAt = input.now + supportConvoyTravelMs(Math.max(0, target.arrivesAt - target.departsAt));
    const reputationChange = warSupportReputationChange("supply", input.side);
    const next = {
      ...supporter,
      resources: { ...supporter.resources, food: supporter.resources.food - food },
      reputation: Math.max(0, Math.min(100, supporter.reputation + reputationChange)),
      notices: [{ kind: "DESTEK", text: `${food} yiyecek taşıyan ikmal konvoyu savaş alanına yola çıktı. Bu tutum itibarınızı ${reputationChange > 0 ? "yükseltti" : "düşürdü"}.`, at: input.now }, ...supporter.notices].slice(0, 20),
    };
    const [saved] = await trx.update(gameSaves).set({ gameState: JSON.stringify(next), revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(gameSaves.userId, input.userId), eq(gameSaves.revision, supporterRow[0].revision))).returning({ userId: gameSaves.userId });
    if (!saved) return { ok: false as const, status: 409, error: "Ambar kaydı değişti; desteği yeniden hazırlayın." };
    await trx.insert(warSupports).values({ id, warId: target.id, supporterId: input.userId, side: input.side, food, sentAt: input.now, arrivesAt });
    await recordWarSupportRelations(trx, { channelId: target.channelId, supporterId: input.userId, attackerId: target.attackerId, defenderId: target.defenderId, kind: "supply", side: input.side });
    await trx.insert(warReports).values({ id: newId("wr"), warId: target.id, userId: input.userId, kind: `support_departure:${id}`, summary: `${food} yiyecek taşıyan ikmal konvoyu yola çıktı; tahmini varış ${new Date(arrivesAt).toLocaleString("tr-TR")}.`, createdAt: input.now });
    return { ok: true as const, arrivesAt };
  });
}

/** Savunana gönderilen gönüllü birlikler, yola çıkarken destekçinin garnizonundan düşer. */
export async function sendWarTroops(input: { warId: string; userId: string; channelId: string; units: Record<string, unknown>; now: number }) {
  const units = normalizeCampaignUnits(input.units);
  if (!totalUnits(units)) return { ok: false as const, status: 400, error: "Destek için en az bir birlik seçin." };
  const db = getDb();
  return db.transaction(async trx => {
    const [[war], [supporterRow], [existing]] = await Promise.all([
      trx.select().from(wars).where(eq(wars.id, input.warId)).limit(1),
      trx.select().from(gameSaves).where(eq(gameSaves.userId, input.userId)).limit(1),
      trx.select({ id: warSupports.id }).from(warSupports).where(and(eq(warSupports.warId, input.warId), eq(warSupports.supporterId, input.userId), eq(warSupports.kind, "troops"), inArray(warSupports.status, ["en_route", "delivered"]))).limit(1),
    ]);
    const supporter = supporterRow ? parseStoredSave(supporterRow.gameState) : null;
    if (!war || war.channelId !== input.channelId) return { ok: false as const, status: 404, error: "Destek verilecek sefer bulunamadı." };
    if (war.attackerId === input.userId || war.defenderId === input.userId) return { ok: false as const, status: 403, error: "Kendi seferinize dış birlik gönderemezsiniz." };
    if (!(["gathering", "marching", "engaged", "siege", "blockade"] as string[]).includes(war.status)) return { ok: false as const, status: 409, error: "Bu sefer artık gönüllü birlik kabul etmiyor." };
    if (existing) return { ok: false as const, status: 409, error: "Bu sefere gönderdiğiniz birlikler hâlâ yolda veya cephede." };
    if (!supporter || !supporterRow) return { ok: false as const, status: 409, error: "Garnizon kaydınız destek için hazır değil." };
    for (const [type, amount] of Object.entries(units)) {
      if ((amount ?? 0) > (supporter.units[type] ?? 0)) return { ok: false as const, status: 409, error: `${type} için garnizonunuzda yeterli birlik yok.` };
    }
    const id = newId("ws");
    const arrivesAt = input.now + supportConvoyTravelMs(Math.max(0, war.arrivesAt - war.departsAt));
    const reputationChange = warSupportReputationChange("troops", "defender");
    const next = {
      ...supporter,
      units: removeUnits(supporter.units, units),
      reputation: Math.max(0, Math.min(100, supporter.reputation + reputationChange)),
      notices: [{ kind: "DESTEK", text: `${totalUnits(units)} gönüllü birlik savunma hattına doğru yola çıktı. Bu tutum itibarınızı yükseltti.`, at: input.now }, ...supporter.notices].slice(0, 20),
    };
    const [saved] = await trx.update(gameSaves).set({ gameState: JSON.stringify(next), revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(gameSaves.userId, input.userId), eq(gameSaves.revision, supporterRow.revision))).returning({ userId: gameSaves.userId });
    if (!saved) return { ok: false as const, status: 409, error: "Garnizon kaydı değişti; desteği yeniden hazırlayın." };
    await trx.insert(warSupports).values({ id, warId: war.id, supporterId: input.userId, side: "defender", kind: "troops", food: 0, units: unitsToStored(units), sentAt: input.now, arrivesAt });
    await recordWarSupportRelations(trx, { channelId: war.channelId, supporterId: input.userId, attackerId: war.attackerId, defenderId: war.defenderId, kind: "troops", side: "defender" });
    await trx.insert(warReports).values({ id: newId("wr"), warId: war.id, userId: input.userId, kind: `troops_departure:${id}`, summary: `${totalUnits(units)} gönüllü birlik savunma hattına yola çıktı; tahmini varış ${new Date(arrivesAt).toLocaleString("tr-TR")}.`, createdAt: input.now, availableAt: input.now });
    return { ok: true as const, arrivesAt };
  });
}

/**
 * Tarafsız bir krallığın saldırana açtığı geçiş hattı. Bu, anlık bir savaş
 * gücü değil; yolculuk sırasında kullanılacak rota bilgisidir. Bu nedenle
 * yalnız ordu henüz hedefe ulaşmadan verilebilir ve varış damgasını gerçekten
 * erkene çeker. Aynı Kral aynı sefere ikinci kez rota açamaz.
 */
export async function grantWarPassage(input: { warId: string; userId: string; channelId: string; now: number }) {
  const db = getDb();
  try {
    return await db.transaction(async trx => {
    const [[war], [existing], [supporterRow]] = await Promise.all([
      trx.select().from(wars).where(eq(wars.id, input.warId)).limit(1),
      trx.select({ id: warSupports.id }).from(warSupports).where(and(
        eq(warSupports.warId, input.warId), eq(warSupports.supporterId, input.userId), eq(warSupports.kind, "passage"),
      )).limit(1),
      trx.select().from(gameSaves).where(eq(gameSaves.userId, input.userId)).limit(1),
    ]);
    const supporter = supporterRow ? parseStoredSave(supporterRow.gameState) : null;
    if (!war || war.channelId !== input.channelId) return { ok: false as const, status: 404, error: "Geçiş hakkı verilecek sefer bulunamadı." };
    if (war.attackerId === input.userId || war.defenderId === input.userId) return { ok: false as const, status: 403, error: "Kendi seferiniz için dış geçiş hakkı veremezsiniz." };
    if (!(["gathering", "marching"] as string[]).includes(war.status)) return { ok: false as const, status: 409, error: "Geçiş hakkı ancak ordu hedefe varmadan verilebilir." };
    if (existing) return { ok: false as const, status: 409, error: "Bu sefere zaten bir geçiş hakkı verdiniz." };
    if (!supporter || !supporterRow) return { ok: false as const, status: 409, error: "Krallık kaydınız geçiş hakkı için hazır değil." };

    const arrivesAt = passageArrivalAt({ departsAt: war.departsAt, arrivesAt: war.arrivesAt, now: input.now, gathering: war.status === "gathering" });
    const [moved] = await trx.update(wars).set({
      arrivesAt,
      // Sınır uyarısı hiçbir zaman ilk haberden geriye gitmez; kısa rota
      // uyarının daha erken gelmesini gerektiriyorsa yalnız o zaman öne çeker.
      defenderAlertAt: Math.min(war.defenderAlertAt, arrivesAt),
      revision: sql`${wars.revision} + 1`,
    }).where(and(eq(wars.id, war.id), eq(wars.status, war.status), eq(wars.arrivesAt, war.arrivesAt))).returning({ id: wars.id });
    if (!moved) return { ok: false as const, status: 409, error: "Sefer çizelgesi değişti; defteri yenileyin." };

    const reputationChange = warSupportReputationChange("passage", "attacker");
    const nextSupporter = {
      ...supporter,
      reputation: Math.max(0, Math.min(100, supporter.reputation + reputationChange)),
      notices: [{ kind: "DESTEK", text: "Saldıran orduya geçiş hakkı verdiniz. Bu tutum itibarınızı düşürdü.", at: input.now }, ...supporter.notices].slice(0, 20),
    };
    const [saved] = await trx.update(gameSaves).set({ gameState: JSON.stringify(nextSupporter), revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(gameSaves.userId, input.userId), eq(gameSaves.revision, supporterRow.revision))).returning({ userId: gameSaves.userId });
    // Sefer çizelgesi ile itibar aynı işlemin parçasıdır; kayıt yarışı varsa
    // yukarıdaki rota kısaltması da transaction geri alınarak iptal olur.
    if (!saved) throw new Error("supporter_save_changed");

    const id = newId("ws");
    await trx.insert(warSupports).values({ id, warId: war.id, supporterId: input.userId, side: "attacker", kind: "passage", food: 0, units: "{}", status: "delivered", sentAt: input.now, arrivesAt: input.now, deliveredAt: input.now });
    await recordWarSupportRelations(trx, { channelId: war.channelId, supporterId: input.userId, attackerId: war.attackerId, defenderId: war.defenderId, kind: "passage", side: "attacker" });
    const events = await trx.select({ sequence: warEvents.sequence }).from(warEvents).where(eq(warEvents.warId, war.id));
    const message = "Tarafsız bir krallık saldıran orduya geçiş hakkı tanıdı; rota kısaldı.";
    await trx.insert(warEvents).values({ warId: war.id, sequence: Math.max(0, ...events.map(event => event.sequence)) + 1, kind: "passage", message, at: input.now, visibleAt: courierArrivalAt(war, input.now) }).onConflictDoNothing();
    await trx.insert(warReports).values([
      { id: newId("wr"), warId: war.id, userId: input.userId, kind: `passage_granted:${id}`, summary: `Geçiş hakkı verdiniz; saldıran ordunun tahmini varışı ${new Date(arrivesAt).toLocaleString("tr-TR")} oldu.`, createdAt: input.now, availableAt: input.now },
      { id: newId("wr"), warId: war.id, userId: war.attackerId, kind: `passage_received:${id}`, summary: "Bir komşu krallık geçiş hakkı tanıdı; ordunuz daha kısa bir rota izliyor.", createdAt: input.now, availableAt: war.kingLeads ? input.now : courierArrivalAt(war, input.now) },
    ]).onConflictDoNothing();
    return { ok: true as const, arrivesAt };
    });
  } catch {
    return { ok: false as const, status: 409, error: "Krallık kaydı veya sefer çizelgesi değişti; desteği yeniden hazırlayın." };
  }
}

async function advanceWarSupports(now: number) {
  const db = getDb();
  let transitioned = 0;
  const due = await db.select().from(warSupports).where(and(eq(warSupports.status, "en_route"), lte(warSupports.arrivesAt, now)));
  for (const support of due) {
    const applied = await db.transaction(async trx => {
      const [current, war] = await Promise.all([
        trx.select().from(warSupports).where(and(eq(warSupports.id, support.id), eq(warSupports.status, "en_route"))).limit(1),
        trx.select().from(wars).where(eq(wars.id, support.warId)).limit(1),
      ]);
      if (!current[0]) return false;
      const troopSupport = current[0].kind === "troops";
      const active = war[0] && ACTIVE_WAR_STATUSES.includes(war[0].status)
        && (!troopSupport || (["gathering", "marching", "engaged", "siege", "blockade"] as string[]).includes(war[0].status));
      const [claimed] = await trx.update(warSupports).set({ status: active ? "delivered" : "late", deliveredAt: now })
        .where(and(eq(warSupports.id, support.id), eq(warSupports.status, "en_route"))).returning({ id: warSupports.id });
      if (!claimed) return false;
      if (!active || !war[0]) {
        await trx.insert(warReports).values({ id: newId("wr"), warId: support.warId, userId: support.supporterId, kind: `support_late:${support.id}`, summary: troopSupport ? "Gönüllü birlikler savaş alanına vardığında sefer sona ermişti; geri dönüş için toplandılar." : "İkmal konvoyu savaş alanına vardığında sefer sona ermişti; yük yerel ihtiyaç sahiplerine bırakıldı.", createdAt: now });
        return true;
      }
      if (troopSupport) {
        const [army] = await trx.select().from(warArmies).where(and(eq(warArmies.warId, war[0].id), eq(warArmies.side, "defender"))).limit(1);
        if (!army) { await trx.rollback(); return false; }
        const units = unitsFromStored(current[0].units);
        await trx.update(warArmies).set({ units: unitsToStored(restoreUnits(unitsFromStored(army.units), units)), updatedAt: now })
          .where(and(eq(warArmies.warId, war[0].id), eq(warArmies.side, "defender")));
        const events = await trx.select({ sequence: warEvents.sequence }).from(warEvents).where(eq(warEvents.warId, war[0].id));
        await trx.insert(warEvents).values({ warId: war[0].id, sequence: Math.max(0, ...events.map(event => event.sequence)) + 1, kind: "troop_support", message: "Gönüllü birlikler savunma hattına ulaştı.", at: now, visibleAt: courierArrivalAt(war[0], now) }).onConflictDoNothing();
        await trx.insert(warReports).values({ id: newId("wr"), warId: war[0].id, userId: support.supporterId, kind: `troops_delivered:${support.id}`, summary: `${totalUnits(units)} gönüllü birlik savunma hattına ulaştı; savaş sonunda hayatta kalanlar geri dönecek.`, createdAt: now, availableAt: now });
        return true;
      }
      await trx.update(warArmies).set({ supply: sql`${warArmies.supply} + ${support.food}`, updatedAt: now })
        .where(and(eq(warArmies.warId, war[0].id), eq(warArmies.side, support.side)));
      const bonus = supportMoraleBonus(support.food);
      await trx.update(wars).set(support.side === "attacker"
        ? { attackerSupportMorale: sql`least(12, ${wars.attackerSupportMorale} + ${bonus})`, revision: sql`${wars.revision} + 1` }
        : { defenderSupportMorale: sql`least(12, ${wars.defenderSupportMorale} + ${bonus})`, revision: sql`${wars.revision} + 1` })
        .where(eq(wars.id, war[0].id));
      const events = await trx.select({ sequence: warEvents.sequence }).from(warEvents).where(eq(warEvents.warId, war[0].id));
      await trx.insert(warEvents).values({ warId: war[0].id, sequence: Math.max(0, ...events.map(event => event.sequence)) + 1, kind: "support", message: `Dış ikmal konvoyu ${support.side === "attacker" ? "saldıran" : "savunan"} orduya ulaştı.`, at: now }).onConflictDoNothing();
      await trx.insert(warReports).values({ id: newId("wr"), warId: war[0].id, userId: support.supporterId, kind: `support_delivered:${support.id}`, summary: `İkmal konvoyunuz ${support.side === "attacker" ? "saldıran" : "savunan"} orduya ${support.food} yiyecek ulaştırdı.`, createdAt: now });
      return true;
    });
    if (applied) transitioned++;
  }
  return transitioned;
}

/** Cepheden sağ dönen gönüllüleri yalnız kendi kayıt kimliklerine iade eder. */
async function settleTroopSupportReturns(now: number) {
  const db = getDb();
  const candidates = await db.select().from(warSupports).where(and(
    eq(warSupports.kind, "troops"), inArray(warSupports.status, ["late", "delivered"]),
  ));
  let returned = 0;
  for (const candidate of candidates) {
    const settled = await db.transaction(async trx => {
      const [[support], [war]] = await Promise.all([
        trx.select().from(warSupports).where(and(eq(warSupports.id, candidate.id), inArray(warSupports.status, ["late", "delivered"]))).limit(1),
        trx.select().from(wars).where(eq(wars.id, candidate.warId)).limit(1),
      ]);
      if (!support || !war || (support.status === "delivered" && war.status !== "resolved")) return false;
      const [supporterRow] = await trx.select().from(gameSaves).where(eq(gameSaves.userId, support.supporterId)).limit(1);
      const supporter = supporterRow ? parseStoredSave(supporterRow.gameState) : null;
      if (!supporter || !supporterRow) return false;
      const units = unitsFromStored(support.units);
      const next = {
        ...supporter,
        units: restoreUnits(supporter.units, units),
        notices: [{ kind: "DESTEK", text: `${totalUnits(units)} gönüllü birlik seferden garnizona döndü.`, at: now }, ...supporter.notices].slice(0, 20),
      };
      const [saved] = await trx.update(gameSaves).set({ gameState: JSON.stringify(next), revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(gameSaves.userId, support.supporterId), eq(gameSaves.revision, supporterRow.revision))).returning({ userId: gameSaves.userId });
      if (!saved) return false;
      const [closed] = await trx.update(warSupports).set({ status: "returned", returnedAt: now })
        .where(and(eq(warSupports.id, support.id), inArray(warSupports.status, ["late", "delivered"]))).returning({ id: warSupports.id });
      if (!closed) { await trx.rollback(); return false; }
      await trx.insert(warReports).values({ id: newId("wr"), warId: war.id, userId: support.supporterId, kind: `troops_returned:${support.id}`, summary: `${totalUnits(units)} gönüllü birlik hayatta kaldı ve garnizonunuza döndü.`, createdAt: now, availableAt: now });
      return true;
    }).catch(() => false);
    if (settled) returned += 1;
  }
  return returned;
}

/**
 * Abluka, "cron kaç kez uyandı" ile değil iki damga arasındaki oyun saatiyle
 * ilerler. Bu yüzden tek uzun gecikme ve sık aralıklı turlar aynı erzak
 * tüketimini/baskı eşiğini üretir. Erzak bittiğinde ordu hemen dönmez: yolu
 * kadar daha savunmasız bir dönüş safhası vardır.
 */
async function advanceBlockade(warId: string, now: number) {
  const db = getDb();
  return db.transaction(async trx => {
    const [war] = await trx.select().from(wars).where(and(eq(wars.id, warId), eq(wars.status, "blockade"))).limit(1);
    if (!war) return false;
    const [attackerRow, defenderRow, army] = await Promise.all([
      trx.select().from(gameSaves).where(eq(gameSaves.userId, war.attackerId)).limit(1),
      trx.select().from(gameSaves).where(eq(gameSaves.userId, war.defenderId)).limit(1),
      trx.select().from(warArmies).where(and(eq(warArmies.warId, war.id), eq(warArmies.side, "attacker"))).limit(1),
    ]);
    const attacker = attackerRow[0] ? parseStoredSave(attackerRow[0].gameState) : null;
    const defender = defenderRow[0] ? parseStoredSave(defenderRow[0].gameState) : null;
    if (!attacker || !defender || !army[0]) return false;
    const units = unitsFromStored(army[0].units);
    const previousAt = Math.max(war.arrivesAt, war.blockadeSettledAt ?? war.arrivesAt);
    const previousHours = blockadeGameHours(war.arrivesAt, previousAt, attacker.speed);
    const requestedHours = blockadeGameHours(war.arrivesAt, now, attacker.speed);
    const nextHours = blockadeHoursCoveredBySupply(units, previousHours, army[0].supply, requestedHours);
    const supplyDue = Math.max(0, blockadeFoodSpent(units, nextHours) - blockadeFoodSpent(units, previousHours));
    const foodSpent = Math.min(army[0].supply, supplyDue);
    const nextSupply = Math.max(0, army[0].supply - foodSpent);
    const pressureSteps = blockadePressureSteps(previousHours, nextHours);
    const experienceSteps = blockadeExperienceSteps(previousHours, nextHours);
    const exhausted = requestedHours > nextHours || (requestedHours > previousHours && nextSupply === 0);
    const returnsAt = exhausted ? now + Math.max(60_000, war.arrivesAt - war.departsAt) : null;

    // Aynı anda kaydedilmiş bir oyun turu, abluka etkisini eski bir kaydın
    // üstüne yazmamalı. Bu durumda hiçbir taraf değişmez; sonraki cron güncel
    // revizyonla tam hesaplamayı tekrarlar.
    if (experienceSteps) {
      const nextAttacker = {
        ...attacker,
        unitExperience: rewardBlockadeExperience(units, attacker.unitExperience, experienceSteps),
        notices: [{ kind: "ABLUKA", text: `${experienceSteps} tam sınır günü sonunda abluka kuvveti saha deneyimi kazandı.`, at: now }, ...attacker.notices].slice(0, 20),
      };
      const [saved] = await trx.update(gameSaves).set({ gameState: JSON.stringify(nextAttacker), revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(gameSaves.userId, war.attackerId), eq(gameSaves.revision, attackerRow[0].revision))).returning({ userId: gameSaves.userId });
      if (!saved) return false;
    }
    if (pressureSteps) {
      const nextDefender = {
        ...defender,
        popularity: Math.max(0, defender.popularity - pressureSteps),
        soldierUnrest: Math.min(100, (defender.soldierUnrest ?? 0) + pressureSteps * 2),
        factionPressure: Math.min(100, (defender.factionPressure ?? 0) + pressureSteps),
        notices: [{ kind: "ABLUKA", text: `Sınır ablukası ${pressureSteps} baskı eşiğini geçti; halkın rızası ve garnizonun düzeni yıpranıyor.`, at: now }, ...defender.notices].slice(0, 20),
      };
      const [saved] = await trx.update(gameSaves).set({ gameState: JSON.stringify(nextDefender), revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(gameSaves.userId, war.defenderId), eq(gameSaves.revision, defenderRow[0].revision))).returning({ userId: gameSaves.userId });
      if (!saved) return false;
    }
    const [moved] = await trx.update(wars).set({
      status: exhausted ? "returning" : "blockade",
      returnsAt,
      blockadeSettledAt: now,
      blockadePressure: war.blockadePressure + pressureSteps,
      revision: sql`${wars.revision} + 1`,
    }).where(and(eq(wars.id, war.id), eq(wars.status, "blockade"))).returning({ id: wars.id });
    if (!moved) return false;
    await trx.update(warArmies).set({ supply: nextSupply, updatedAt: now })
      .where(and(eq(warArmies.warId, war.id), eq(warArmies.side, "attacker")));
    if (pressureSteps || exhausted) {
      const events = await trx.select({ sequence: warEvents.sequence }).from(warEvents).where(eq(warEvents.warId, war.id));
      const sequence = Math.max(0, ...events.map(event => event.sequence)) + 1;
      const message = exhausted
        ? "Abluka erzağı tükendi; sınır kuvveti geri dönüşe geçti."
        : `Abluka baskısı hedefte ${pressureSteps} yeni huzursuzluk eşiği yarattı.`;
      const reportAt = courierArrivalAt(war, now);
      await trx.insert(warEvents).values({ warId: war.id, sequence, kind: exhausted ? "blockade_withdraw" : "blockade_pressure", message, at: now, visibleAt: reportAt }).onConflictDoNothing();
      await trx.insert(warReports).values([
        { id: newId("wr"), warId: war.id, userId: war.attackerId, kind: exhausted ? "blockade_exhausted" : `blockade_pressure:${war.blockadePressure + pressureSteps}`, summary: exhausted ? "Abluka ikmali tükendi; General kuvveti geri dönüşe aldı." : `Abluka baskısı hedefte hissediliyor. ${nextSupply} yiyecek kaldı.`, createdAt: now, availableAt: war.kingLeads ? now : reportAt },
        { id: newId("wr"), warId: war.id, userId: war.defenderId, kind: exhausted ? "blockade_ended" : `blockade_pressure:${war.blockadePressure + pressureSteps}`, summary: exhausted ? "Sınırdaki abluka kuvveti ikmali tükenince geri dönüşe geçti." : "Açık abluka baskısı sürüyor; halk ve garnizon yeni bir huzursuzluk eşiği yaşadı.", createdAt: now, availableAt: reportAt },
      ]).onConflictDoNothing();
    }
    return true;
  });
}

/**
 * Sefer zaman çizelgesini cron ilerletir. Her geçiş durumun kendisiyle
 * koşulludur; iki cron aynı anda uyansa bile yalnızca kazanan olay yazar.
 */
export async function advanceWars(now: number) {
  const db = getDb();
  let transitioned = await advanceWarCommands(now);
  transitioned += await advanceWarSupports(now);
  const departures = await db.select().from(wars)
    .where(and(eq(wars.status, "gathering"), lte(wars.departsAt, now)));
  for (const war of departures) {
    const [claimed] = await db.update(wars).set({ status: "marching", revision: sql`${wars.revision} + 1` })
      .where(and(eq(wars.id, war.id), eq(wars.status, "gathering"))).returning({ id: wars.id });
    if (!claimed) continue;
    await db.insert(warEvents).values({ warId: war.id, sequence: 2, kind: "march", message: "Ordu hedefe doğru yürüyüşe geçti.", at: now }).onConflictDoNothing();
    transitioned++;
  }

  const arrivals = await db.select().from(wars)
    .where(and(eq(wars.status, "marching"), lte(wars.arrivesAt, now)));
  for (const war of arrivals) {
    if (await resolveArrival(war.id, now)) transitioned++;
  }

  const battles = await db.select().from(wars)
    .where(and(eq(wars.status, "engaged"), lte(wars.nextBattleAt, now)));
  for (const war of battles) {
    if (await advanceBattlePhase(war.id, now)) transitioned++;
  }

  const sieges = await db.select().from(wars)
    .where(and(eq(wars.status, "siege"), lte(wars.siegeEndsAt, now)));
  for (const war of sieges) {
    if (await resolveSiegeEnd(war.id, now)) transitioned++;
  }

  const blockades = await db.select().from(wars)
    .where(eq(wars.status, "blockade"));
  for (const war of blockades) {
    if (await advanceBlockade(war.id, now)) transitioned++;
  }

  const returns = await db.select().from(wars)
    .where(and(eq(wars.status, "returning"), lte(wars.returnsAt, now)));
  for (const war of returns) {
    if (await settleReturn(war.id, now)) transitioned++;
  }
  transitioned += await settleTroopSupportReturns(now);
  return transitioned;
}

export async function returnWar(input: { warId: string; userId: string; now: number }) {
  const db = getDb();
  const [war] = await db.select().from(wars).where(eq(wars.id, input.warId)).limit(1);
  if (!war) return { ok: false as const, status: 404, error: "Sefer bulunamadı." };
  if (war.attackerId !== input.userId) return { ok: false as const, status: 403, error: "Yalnız seferi mühürleyen Kral geri çekilme emri verebilir." };
  if (!(["gathering", "marching", "engaged", "siege", "blockade"] as string[]).includes(war.status)) return { ok: false as const, status: 409, error: "Bu sefer artık geri çekilemez." };
  const oneWayMs = war.status === "gathering" ? 0 : Math.max(60_000, war.arrivesAt - war.departsAt);
  const [updated] = await db.update(wars).set({ status: "returning", returnsAt: input.now + oneWayMs, revision: sql`${wars.revision} + 1` })
    .where(and(eq(wars.id, war.id), inArray(wars.status, ["gathering", "marching", "engaged", "siege", "blockade"])))
    .returning({ id: wars.id, returnsAt: wars.returnsAt });
  if (!updated) return { ok: false as const, status: 409, error: "Sefer durumu bu arada değişti; yeniden deneyin." };
  const events = await db.select({ sequence: warEvents.sequence }).from(warEvents).where(eq(warEvents.warId, war.id));
  const sequence = Math.max(0, ...events.map(event => event.sequence)) + 1;
  await db.insert(warEvents).values({ warId: war.id, sequence, kind: "withdraw", message: war.status === "gathering" ? "Kralın emriyle toplanma iptal edildi; birlikler garnizona dönüyor." : "Kralın emriyle ordu geri dönüşe geçti.", at: input.now }).onConflictDoNothing();
  return { ok: true as const, returnsAt: updated.returnsAt! };
}

/**
 * Savaş ilanından sonra eğitimini bitiren birlikleri savunma hattına ekler.
 * İlk savunma kaydı ilan anındaki bütün garnizonu zaten içerir; bu yüzden
 * yalnız o kaydın ÜZERİNDE kalan yeni birlikler seçilebilir. Böylece aynı
 * mızrakçı ikinci kez yazılamaz ve birlikler oyuncu kaydından silinmez.
 */
export async function reinforceDefender(input: { warId: string; userId: string; units: Record<string, unknown>; now: number }) {
  const requested = normalizeCampaignUnits(input.units);
  if (!totalUnits(requested)) return { ok: false as const, status: 400, error: "Takviye için en az bir birlik seçmelisiniz." };
  const db = getDb();
  return db.transaction(async trx => {
    const [war] = await trx.select().from(wars).where(and(eq(wars.id, input.warId), inArray(wars.status, ["gathering", "marching", "engaged"]))).limit(1);
    if (!war) return { ok: false as const, status: 409, error: "Takviye yalnız yaklaşan orduya veya çatışma safhaları arasındaki savunma hattına gönderilebilir." };
    if (war.defenderId !== input.userId) return { ok: false as const, status: 403, error: "Savunma takviyesini yalnız kuşatılan Krallığın Kralı seçebilir." };
    if (war.defenderAlertAt > input.now) return { ok: false as const, status: 409, error: "Sınırdan doğrulanmış bir tehdit haberi henüz ulaşmadı." };
    const [[army], [saveRow]] = await Promise.all([
      trx.select().from(warArmies).where(and(eq(warArmies.warId, war.id), eq(warArmies.side, "defender"))).limit(1),
      trx.select().from(gameSaves).where(eq(gameSaves.userId, input.userId)).limit(1),
    ]);
    const game = saveRow ? parseStoredSave(saveRow.gameState) : null;
    if (!army || !game) return { ok: false as const, status: 409, error: "Garnizon kaydı takviye için hazır değil." };
    const current = unitsFromStored(army.units);
    const next = { ...current };
    for (const [type, amount] of Object.entries(requested)) {
      const available = Math.max(0, (game.units[type] ?? 0) - (current[type as keyof CampaignUnits] ?? 0));
      if ((amount ?? 0) > available) return { ok: false as const, status: 409, error: `${type} için yalnız ${available} yeni birlik savunma hattına eklenebilir.` };
      next[type as keyof CampaignUnits] = (next[type as keyof CampaignUnits] ?? 0) + (amount ?? 0);
    }
    await trx.update(warArmies).set({ units: unitsToStored(next), updatedAt: input.now })
      .where(and(eq(warArmies.warId, war.id), eq(warArmies.side, "defender")));
    const rows = await trx.select({ sequence: warEvents.sequence }).from(warEvents).where(eq(warEvents.warId, war.id));
    await trx.insert(warEvents).values({
      warId: war.id, sequence: Math.max(0, ...rows.map(row => row.sequence)) + 1, kind: "defense_reinforcement",
      message: "Savunma hattına yeni birlikler katıldı.", at: input.now,
      // Saldıran taraf, takviyeyi anında değil ancak kendi habercisiyle saha
      // sonucu geldikten sonra öğrenir.
      visibleAt: courierArrivalAt(war, input.now),
    }).onConflictDoNothing();
    await trx.insert(warReports).values({
      id: newId("wr"), warId: war.id, userId: input.userId, kind: `defense_reinforcement:${input.now}`,
      summary: `${totalUnits(requested)} yeni birlik savunma hattına katıldı.`, createdAt: input.now, availableAt: input.now,
    });
    return { ok: true as const, units: next };
  });
}

export async function warDashboardFor(userId: string, channelId: string, now = Date.now()) {
  const db = getDb();
  const [rows, channelWars] = await Promise.all([
    db.select().from(wars).where(and(eq(wars.channelId, channelId), or(eq(wars.attackerId, userId), eq(wars.defenderId, userId)))).orderBy(asc(wars.createdAt)),
    db.select().from(wars).where(and(eq(wars.channelId, channelId), inArray(wars.status, ACTIVE_WAR_STATUSES))).orderBy(asc(wars.createdAt)),
  ]);
  const supportable = channelWars.filter(war => war.attackerId !== userId && war.defenderId !== userId);
  const participantIds = [...new Set(supportable.flatMap(war => [war.attackerId, war.defenderId]))];
  const participantRows = participantIds.length ? await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, participantIds)) : [];
  const participantNames = new Map(participantRows.map(row => [row.id, row.displayName]));
  // Savunan, taze karşı-istihbaratı yoksa ordu sınıra ulaşana kadar bu seferin
  // kimliğini ve ayrıntılarını görmez. Savaş satırındaki damga, ilan anında
  // sabitlenir; sonradan açılan ajan raporu geçmişi değiştiremez.
  const visibleRows = rows.filter(row => row.attackerId === userId || row.defenderAlertAt <= now);
  const ids = visibleRows.map(row => row.id);
  const [armies, events, allReports] = ids.length ? await Promise.all([
    db.select().from(warArmies).where(inArray(warArmies.warId, ids)),
    db.select().from(warEvents).where(and(inArray(warEvents.warId, ids), lte(warEvents.visibleAt, now))).orderBy(asc(warEvents.sequence)),
    db.select().from(warReports).where(and(eq(warReports.userId, userId), inArray(warReports.warId, ids))).orderBy(asc(warReports.createdAt)),
  ]) : [[], [], []] as const;
  const reports = allReports.filter(report => report.availableAt <= now);
  // Aynı savaşın birden çok gecikmiş raporu olabilir; arayüzde her savaş için
  // yalnız sıradaki haberciyi gösteririz.
  const couriersByWar = new Map<string, number>();
  for (const report of allReports.filter(item => item.availableAt > now)) {
    const previous = couriersByWar.get(report.warId);
    if (previous === undefined || report.availableAt < previous) couriersByWar.set(report.warId, report.availableAt);
  }
  const couriers = [...couriersByWar].map(([warId, availableAt]) => ({ warId, availableAt }));
  return {
    wars: visibleRows.map(war => ({
      ...war,
      role: war.attackerId === userId ? "attacker" as const : "defender" as const,
      armies: armies.filter(army => army.warId === war.id).map(army => ({ ...army, units: unitsFromStored(army.units) })),
      events: events.filter(event => event.warId === war.id),
    })),
    reports,
    couriers,
    supportableWars: supportable.map(war => ({
      id: war.id, objective: war.objective, status: war.status, targetTerrain: war.targetTerrain,
      attackerName: participantNames.get(war.attackerId) ?? "Bilinmeyen krallık",
      defenderName: participantNames.get(war.defenderId) ?? "Bilinmeyen krallık",
    })),
  };
}
