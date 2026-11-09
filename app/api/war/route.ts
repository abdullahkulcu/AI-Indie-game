import { and, desc, eq, gt, gte, inArray, lte, or, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { agreements, channelMembers, gameSaves, intelMissions, warArmies, warDefenses, warEvents, warReports, wars } from "../../../db/schema";
import { estimateMarch, campaignSupplyPlan, gatheringDurationMs, normalizeCampaignUnits, type CampaignUnits } from "../../../engine/march";
import { isUnitType } from "../../../engine/units";
import { clampWithdrawThreshold, counterIntelFreshWindowMs, defenderAlertAt, isDefenseDoctrine, isWarApproach, isWarObjective, warTargetCooldownMs } from "../../../engine/war";
import { layoutChannel, type MemberInput } from "../../../engine/world-map";
import { civicResponseForDefense } from "../../../engine/war-populace";
import { reputationChange } from "../../../engine/diplomacy";
import { currentUser } from "../../../server/account-auth";
import { activeMembershipOf } from "../../../server/active-membership";
import { newId } from "../../../server/ids";
import { RATE_LIMITS, consumeRateLimit, rateLimitResponse } from "../../../server/rate-limit";
import { parseStoredSave } from "../../../server/save-validation";
import { ACTIVE_WAR_STATUSES, advanceWars, grantWarPassage, issueWarCommand, offerWarPeace, pursueReturningArmy, reinforceDefender, returnWar, sallyFromSiege, sendWarSupply, sendWarTroops, unitsToStored, warDashboardFor } from "../../../server/war-desk";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

type Body = {
  action?: "plan" | "declare" | "set_doctrine" | "withdraw" | "sally" | "offer_peace" | "read_report" | "support_supply" | "support_troops" | "support_passage" | "field_command" | "reinforce_defense" | "pursue";
  targetId?: string;
  objective?: string;
  units?: Record<string, unknown>;
  approach?: string;
  supply?: number;
  withdrawThreshold?: number;
  kingLeads?: boolean;
  side?: "attacker" | "defender";
  food?: number;
  supportUnits?: Record<string, unknown>;
  command?: "advance" | "hold" | "withdraw";
  reinforcementUnits?: Record<string, unknown>;
  doctrine?: string;
  warId?: string;
  reportId?: string;
};

type PreparedCampaign = {
  ownRevision: number;
  target: { id: string; game: NonNullable<ReturnType<typeof parseStoredSave>>; position: { x: number; z: number } };
  own: NonNullable<ReturnType<typeof parseStoredSave>>;
  units: CampaignUnits;
  march: NonNullable<ReturnType<typeof estimateMarch>>;
  gatheringMs: number;
  minimumSupply: number;
  supplyPlan: ReturnType<typeof campaignSupplyPlan>;
  defenderHasFreshCounterIntel: boolean;
};

async function preparedCampaign(userId: string, channel: NonNullable<Awaited<ReturnType<typeof activeMembershipOf>>>, body: Body, now: number): Promise<{ ok: true; campaign: PreparedCampaign } | { ok: false; error: string; status: number }> {
  if (!body.targetId || body.targetId === userId) return { ok: false, status: 400, error: "Sefer için başka bir krallık seçmelisiniz." };
  if (!isWarObjective(body.objective)) return { ok: false, status: 400, error: "Geçerli bir savaş amacı seçin." };
  const db = getDb();
  const [ownRow, targetRow, members, discovery, counterIntel] = await Promise.all([
    db.select().from(gameSaves).where(eq(gameSaves.userId, userId)).limit(1),
    db.select().from(gameSaves).where(eq(gameSaves.userId, body.targetId)).limit(1),
    db.select({ userId: channelMembers.userId, joinedAt: channelMembers.joinedAt, gameState: gameSaves.gameState }).from(channelMembers)
      .innerJoin(gameSaves, eq(gameSaves.userId, channelMembers.userId))
      .where(and(eq(channelMembers.channelId, channel.channelId), eq(channelMembers.status, "active"))).orderBy(channelMembers.joinedAt),
    db.select({ id: intelMissions.id }).from(intelMissions).where(and(eq(intelMissions.channelId, channel.channelId), eq(intelMissions.sourceUserId, userId), eq(intelMissions.targetUserId, body.targetId), eq(intelMissions.status, "succeeded"))).orderBy(desc(intelMissions.completesAt)).limit(1),
    db.select({ id: intelMissions.id }).from(intelMissions).where(and(
      eq(intelMissions.channelId, channel.channelId), eq(intelMissions.sourceUserId, body.targetId), eq(intelMissions.targetUserId, userId), eq(intelMissions.status, "succeeded"),
      gte(intelMissions.completesAt, now - counterIntelFreshWindowMs(channel.channelSpeed)),
    )).orderBy(desc(intelMissions.completesAt)).limit(1),
  ]);
  const own = ownRow[0] ? parseStoredSave(ownRow[0].gameState) : null;
  const target = targetRow[0] ? parseStoredSave(targetRow[0].gameState) : null;
  if (!own || !ownRow[0] || own.channel !== channel.channelName) return { ok: false, status: 409, error: "Krallık kaydınız sefer için hazır değil." };
  if (!target || target.channel !== channel.channelName) return { ok: false, status: 404, error: "Hedef bu aktif channel'da değil." };
  if (!discovery[0]) return { ok: false, status: 403, error: "Bu hedef için önce başarılı bir keşif raporu gerekir." };
  if (own.protectionEndsAt > now) return { ok: false, status: 409, error: "Kuruluş korumanız sürerken sefer ilan edemezsiniz." };
  if (target.protectionEndsAt > now) return { ok: false, status: 409, error: "Hedef krallık kuruluş koruması altında." };

  const layout = layoutChannel(channel.channelId, members.flatMap<MemberInput>(member => {
    const save = parseStoredSave(member.gameState);
    return save && save.channel === channel.channelName ? [{ userId: member.userId, terrain: save.terrain }] : [];
  }));
  const from = layout.get(userId), to = layout.get(body.targetId);
  if (!from || !to) return { ok: false, status: 409, error: "Harita yerleşimi henüz hazır değil; biraz sonra tekrar deneyin." };

  const units = normalizeCampaignUnits(body.units ?? {});
  if (!Object.keys(units).length) return { ok: false, status: 400, error: "Sefere en az bir birlik seçmelisiniz." };
  if ((units.siege_team ?? 0) > 0 && Object.entries(units).every(([type, count]) => type === "siege_team" || !count)) return { ok: false, status: 400, error: "Kuşatma Ekibi tek başına sefere çıkamaz." };
  for (const [type, count] of Object.entries(units)) {
    if (!isUnitType(type) || count > (own.units[type] ?? 0)) return { ok: false, status: 400, error: "Seçilen birlik miktarı garnizondaki miktarı aşıyor." };
  }
  const march = estimateMarch({ from, to, units, targetTerrain: target.terrain, channelSpeed: channel.channelSpeed });
  const gatheringMs = gatheringDurationMs(units, channel.channelSpeed);
  if (!march || gatheringMs === null) return { ok: false, status: 400, error: "Sefer kuvveti hesaplanamadı." };
  // Abluka ilk yirmi dört oyun saatini de peşinen besleyebilmeli. Daha uzun
  // baskı, Kralın bilerek ayırdığı ek erzak veya dış ikmal ister.
  const supplyPlan = campaignSupplyPlan({ units, oneWayGameHours: march.gameHours, expectedBattleHours: body.objective === "blockade" ? 24 : 3 });
  const minimumSupply = supplyPlan.totalFood;
  return { ok: true, campaign: { own, ownRevision: ownRow[0].revision, target: { id: body.targetId, game: target, position: to }, units, march, gatheringMs, minimumSupply, supplyPlan, defenderHasFreshCounterIntel: Boolean(counterIntel[0]) } };
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return json({ error: "Oturum gerekli." }, 401);
  const membership = await activeMembershipOf(user.id);
  if (!membership) return json({ error: "Aktif bir channel'a katılmadınız." }, 403);
  await advanceWars(Date.now());
  const dashboard = await warDashboardFor(user.id, membership.channelId, Date.now());
  const [defense] = await getDb().select().from(warDefenses).where(and(eq(warDefenses.userId, user.id), eq(warDefenses.channelId, membership.channelId))).limit(1);
  return json({ ...dashboard, doctrine: defense?.doctrine ?? "balanced" });
}

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return json({ error: "Oturum gerekli." }, 401);
  const limit = await consumeRateLimit(RATE_LIMITS.war, `user:${user.id}`);
  if (!limit.allowed) return rateLimitResponse(limit, "Sefer emirleri çok sık verildi; biraz sonra tekrar deneyin.");
  const membership = await activeMembershipOf(user.id);
  if (!membership) return json({ error: "Aktif bir channel'a katılmadınız." }, 403);
  const body = await request.json() as Body;
  const now = Date.now();
  await advanceWars(now);

  if (body.action === "set_doctrine") {
    if (!isDefenseDoctrine(body.doctrine)) return json({ error: "Geçerli bir savunma doktrini seçin." }, 400);
    await getDb().insert(warDefenses).values({ userId: user.id, channelId: membership.channelId, doctrine: body.doctrine, updatedAt: now })
      .onConflictDoUpdate({ target: [warDefenses.userId, warDefenses.channelId], set: { doctrine: body.doctrine, updatedAt: now } });
    return json({ doctrine: body.doctrine });
  }

  if (body.action === "withdraw") {
    const result = await returnWar({ warId: String(body.warId ?? ""), userId: user.id, now });
    return result.ok ? json({ withdrawn: true, returnsAt: result.returnsAt }) : json({ error: result.error }, result.status);
  }

  if (body.action === "sally") {
    const result = await sallyFromSiege({ warId: String(body.warId ?? ""), userId: user.id, now });
    return result.ok ? json({ sallied: true, returned: result.returned, returnsAt: result.returnsAt }) : json({ error: result.error }, result.status);
  }

  if (body.action === "offer_peace") {
    const result = await offerWarPeace({ warId: String(body.warId ?? ""), userId: user.id, now });
    return result.ok ? json({ negotiationId: result.negotiationId }) : json({ error: result.error }, result.status);
  }

  if (body.action === "support_supply") {
    if (body.side !== "attacker" && body.side !== "defender") return json({ error: "Destek tarafı geçersiz." }, 400);
    const result = await sendWarSupply({ warId: String(body.warId ?? ""), userId: user.id, channelId: membership.channelId, side: body.side, food: Number(body.food), now });
    return result.ok ? json({ supportArrivesAt: result.arrivesAt }) : json({ error: result.error }, result.status);
  }

  if (body.action === "support_passage") {
    const result = await grantWarPassage({ warId: String(body.warId ?? ""), userId: user.id, channelId: membership.channelId, now });
    return result.ok ? json({ passageArrivesAt: result.arrivesAt }) : json({ error: result.error }, result.status);
  }

  if (body.action === "support_troops") {
    const result = await sendWarTroops({ warId: String(body.warId ?? ""), userId: user.id, channelId: membership.channelId, units: body.supportUnits ?? {}, now });
    return result.ok ? json({ supportArrivesAt: result.arrivesAt }) : json({ error: result.error }, result.status);
  }

  if (body.action === "field_command") {
    if (body.command !== "advance" && body.command !== "hold" && body.command !== "withdraw") return json({ error: "Saha emri geçersiz." }, 400);
    const result = await issueWarCommand({ warId: String(body.warId ?? ""), userId: user.id, kind: body.command, now });
    return result.ok ? json({ commandArrivesAt: result.arrivesAt }) : json({ error: result.error }, result.status);
  }

  if (body.action === "reinforce_defense") {
    const result = await reinforceDefender({ warId: String(body.warId ?? ""), userId: user.id, units: body.reinforcementUnits ?? {}, now });
    return result.ok ? json({ reinforced: true, units: result.units }) : json({ error: result.error }, result.status);
  }

  if (body.action === "pursue") {
    const result = await pursueReturningArmy({ warId: String(body.warId ?? ""), userId: user.id, now });
    return result.ok ? json({ pursued: true }) : json({ error: result.error }, result.status);
  }

  if (body.action === "read_report") {
    const [updated] = await getDb().update(warReports).set({ readAt: now }).where(and(eq(warReports.id, String(body.reportId ?? "")), eq(warReports.userId, user.id), lte(warReports.availableAt, now))).returning({ id: warReports.id });
    return updated ? json({ read: true }) : json({ error: "Savaş raporu bulunamadı." }, 404);
  }

  if (body.action !== "plan" && body.action !== "declare") return json({ error: "Geçersiz sefer emri." }, 400);
  if (!isWarObjective(body.objective)) return json({ error: "Geçerli bir savaş amacı seçin." }, 400);
  const objective = body.objective;
  const prepared = await preparedCampaign(user.id, membership, body, now);
  if (!prepared.ok) return json({ error: prepared.error }, prepared.status);
  const { campaign } = prepared;
  const requestedSupply = Math.floor(Number(body.supply) || campaign.minimumSupply);
  const supply = Math.max(campaign.minimumSupply, requestedSupply);
  if (supply > Math.floor(campaign.own.resources.food)) return json({ error: `Bu sefer için en az ${campaign.minimumSupply} yiyecek gerekir.` }, 409);
  const approach = isWarApproach(body.approach) ? body.approach : "balanced";
  const withdrawThreshold = clampWithdrawThreshold(body.withdrawThreshold);
  const preview = {
    objective, targetId: campaign.target.id, targetTerrain: campaign.target.game.terrain,
    units: campaign.units, distance: campaign.march.distance, gameHours: campaign.march.gameHours,
    gatheringMs: campaign.gatheringMs, marchMs: campaign.march.durationMs, minimumSupply: campaign.minimumSupply, supplyPlan: campaign.supplyPlan,
    supply, approach, withdrawThreshold,
    kingLeads: body.kingLeads === true,
  };
  if (body.action === "plan") return json({ preview });

  const db = getDb();
  const [pact, cooldown, active] = await Promise.all([
    db.select({ id: agreements.id }).from(agreements).where(and(
      eq(agreements.channelId, membership.channelId), eq(agreements.status, "active"), eq(agreements.topic, "non_aggression"), gt(agreements.endsAt, now),
      or(and(eq(agreements.payerId, user.id), eq(agreements.payeeId, campaign.target.id)), and(eq(agreements.payerId, campaign.target.id), eq(agreements.payeeId, user.id))),
    )).limit(1),
    db.select({ id: wars.id }).from(wars).where(and(eq(wars.attackerId, user.id), eq(wars.defenderId, campaign.target.id), gt(wars.resolvedAt, now - warTargetCooldownMs(membership.channelSpeed)))).limit(1),
    // Bir Kral savunmadayken aynı garnizonu ikinci bir saldırı seferine de
    // ayıramaz. Yalnız attackerId kontrolü, aynı oyuncunun iki cephede aynı
    // birlikleri görünmez biçimde kullanmasına izin veriyordu.
    db.select({ id: wars.id }).from(wars).where(and(or(eq(wars.attackerId, user.id), eq(wars.defenderId, user.id)), inArray(wars.status, ACTIVE_WAR_STATUSES))).limit(1),
  ]);
  if (pact[0] && objective !== "blockade") return json({ error: "Yürürlükte bir saldırmazlık anlaşması varken sefer ilan edemezsiniz." }, 409);
  if (cooldown[0]) return json({ error: "Bu hedefle son seferin ardından kısa bir dokunulmazlık süresi var." }, 409);
  if (active[0]) return json({ error: "Ordunuz zaten başka bir seferde; önce dönüşünü veya sonucunu bekleyin." }, 409);
  const [defense] = await db.select().from(warDefenses).where(and(eq(warDefenses.userId, campaign.target.id), eq(warDefenses.channelId, membership.channelId))).limit(1);
  const id = newId("war");
  const departsAt = now + campaign.gatheringMs;
  const arrivesAt = departsAt + campaign.march.durationMs;
  const defenderSeesAt = defenderAlertAt(now, departsAt, campaign.defenderHasFreshCounterIntel);
  const civicResponse = civicResponseForDefense({
    popularity: campaign.target.game.popularity,
    factionPressure: campaign.target.game.factionPressure,
    food: campaign.target.game.resources.food,
    soldierUnrest: campaign.target.game.soldierUnrest,
  });
  const reservedUnits = { ...campaign.own.units };
  for (const [type, count] of Object.entries(campaign.units)) reservedUnits[type] = Math.max(0, (reservedUnits[type] ?? 0) - (count ?? 0));
  const reservedSave = {
    ...campaign.own,
    units: reservedUnits,
    resources: { ...campaign.own.resources, food: Math.max(0, campaign.own.resources.food - supply) },
    reputation: pact[0] && objective === "blockade" ? Math.max(0, campaign.own.reputation + reputationChange("betrayal")) : campaign.own.reputation,
    notices: [{ kind: objective === "blockade" ? "ABLUKA" : "SEFER", text: objective === "blockade"
      ? `${campaign.march.gameHours.toFixed(1)} oyun saatlik sınır yürüyüşü ve ilk baskı dönemi için ${supply} yiyecek ayrıldı.${pact[0] ? " İmzalı saldırmazlık anlaşması bozuldu; itibar kaybı işlendi." : ""}`
      : `${campaign.march.gameHours.toFixed(1)} oyun saatlik sefer için birlikler ve ${supply} yiyecek ayrıldı.`, at: now }, ...campaign.own.notices].slice(0, 20),
  };
  try {
    const declared = await db.transaction(async trx => {
      const [reserved] = await trx.update(gameSaves)
        .set({ gameState: JSON.stringify(reservedSave), revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(gameSaves.userId, user.id), eq(gameSaves.revision, campaign.ownRevision)))
        .returning({ userId: gameSaves.userId });
      if (!reserved) return false;
      if (pact[0] && objective === "blockade") {
        await trx.update(agreements).set({ status: "broken" }).where(eq(agreements.id, pact[0].id));
      }
      await trx.insert(wars).values({ id, channelId: membership.channelId, attackerId: user.id, defenderId: campaign.target.id, objective, status: "gathering", targetTerrain: campaign.target.game.terrain, distance: campaign.march.distance, marchHours: campaign.march.gameHours, createdAt: now, departsAt, arrivesAt, defenderAlertAt: defenderSeesAt, defenderCivicResponse: civicResponse.id, defenderMoraleBonus: civicResponse.moraleBonus, kingLeads: body.kingLeads === true });
      await trx.insert(warArmies).values([
        { warId: id, side: "attacker", units: unitsToStored(campaign.units), supply, initialSupply: supply, approach, withdrawThreshold, updatedAt: now },
        { warId: id, side: "defender", units: unitsToStored(campaign.target.game.units), supply: 0, initialSupply: 0, approach: defense?.doctrine ?? "balanced", withdrawThreshold: civicResponse.withdrawThreshold, updatedAt: now },
      ]);
      await trx.insert(warReports).values([
        { id: newId("wr"), warId: id, userId: user.id, kind: "declaration", summary: objective === "blockade" ? "Abluka mührü vuruldu. Birlikler garnizondan ayrıldı; sınır hattı ve erzak katarı hazırlanıyor." : "Sefer mührü vuruldu. Birlikler garnizondan ayrıldı; erzakla birlikte toplanıyor.", createdAt: now },
        { id: newId("wr"), warId: id, userId: campaign.target.id, kind: "warning", summary: campaign.defenderHasFreshCounterIntel ? `Ajanlarınız ${campaign.own.kingdomName}'nin sınır ${objective === "blockade" ? "ablukasını" : "seferini"} hazırlık aşamasında açığa çıkardı. Kayıtlı savunma doktrininiz hazır tutuluyor. ${civicResponse.report}` : `Sınır gözcüleri hareket hâlindeki bir ordunun kimliğini teyit etti: ${campaign.own.kingdomName} topraklarınıza ${objective === "blockade" ? "açık abluka kurmaya" : "yürümeye"} hazırlanıyor. Kayıtlı savunma doktrininiz hazır tutuluyor. ${civicResponse.report}`, createdAt: now, availableAt: defenderSeesAt },
      ]);
      await trx.insert(warEvents).values({ warId: id, sequence: 1, kind: "gather", message: objective === "blockade" ? "Kral abluka emrini mühürledi; birlikler ve erzak sınır hattı için garnizondan ayrıldı." : "Kral sefer emrini mühürledi; birlikler ve erzak garnizondan ayrıldı.", at: now });
      return true;
    });
    if (!declared) return json({ error: "Garnizon kaydı bu arada değişti; sefer hesabını yeniden yapın." }, 409);
  } catch {
    // Kısmi benzersiz dizin aynı anda ikinci seferi de durdurur; iç hata ayrıntısı oyuncuya sızmaz.
    return json({ error: "Bu taraflardan biri için hâlihazırda aktif bir sefer var; haritayı yenileyin." }, 409);
  }
  return json({ declared: true, warId: id, departsAt, arrivesAt, preview });
}
