import { and, count, desc, eq, gt, lte, or, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { agitations, channelMembers, channels, gameSaves, intelDefenses, intelMissions } from "../../../db/schema";
import { currentUser } from "../../../server/account-auth";
import { intelReportOf, isStaleReport, projectPublicKingdom, type IntelReport } from "../../../server/world-projection";
import { sendAgitation } from "../../../server/agitation-desk";
import { AGITATION, agitationDayStart } from "../../../engine/agitation";
import { isTraded } from "../../../engine/market";
import type { TradeKey } from "../../../engine/types";
import { layoutChannel, sharedMinePosition, worldExtent, type MemberInput } from "../../../engine/world-map";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };
const response = (body: unknown, status = 200) => Response.json(body, { status, headers });

async function channelFor(userId: string, channelId: string) {
  const [channel] = await getDb().select({ id: channels.id, name: channels.name, speed: channels.speed }).from(channels).where(and(eq(channels.id, channelId), eq(channels.status, "active"))).limit(1);
  if (!channel) return null;
  const [membership] = await getDb().select({ userId: channelMembers.userId }).from(channelMembers).where(and(eq(channelMembers.userId, userId), eq(channelMembers.channelId, channel.id), eq(channelMembers.status, "active"))).limit(1);
  return membership ? channel : null;
}

async function resolveDueMissions(userId: string, channelId: string, channelName: string) {
  const due = await getDb().select().from(intelMissions).where(and(eq(intelMissions.channelId, channelId), eq(intelMissions.status, "pending"), lte(intelMissions.completesAt, Date.now()), or(eq(intelMissions.sourceUserId, userId), eq(intelMissions.targetUserId, userId))));
  for (const mission of due) {
    const [save] = await getDb().select({ gameState: gameSaves.gameState }).from(gameSaves).where(eq(gameSaves.userId, mission.targetUserId)).limit(1);
    const snapshot = save ? projectPublicKingdom(mission.targetUserId, save.gameState, channelName) : null;
    const succeeded = Boolean(snapshot) && crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 * 100 < mission.successChance;
    const detected = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 * 100 < mission.detectionChance;
    const status = succeeded ? "succeeded" as const : detected ? "detected" as const : "failed" as const;
    // Raporun NE İÇERDİĞİ tek yerde kararlaşır (server/world-projection.ts →
    // intelReportOf). Eskiden anlık görüntünün tamamı yazılıyordu ve karşı
    // krallığın AMBARI raporun içinde istemciye iniyordu.
    await getDb().update(intelMissions).set({ status, report: succeeded && snapshot ? JSON.stringify(intelReportOf(snapshot)) : null, resolvedAt: sql`CURRENT_TIMESTAMP` }).where(and(eq(intelMissions.id, mission.id), eq(intelMissions.status, "pending")));
  }
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return response({ error: "Oturum gerekli." }, 401);
  const channelId = new URL(request.url).searchParams.get("channelId")?.trim();
  if (!channelId) return response({ error: "Channel gerekli." }, 400);
  const channel = await channelFor(user.id, channelId);
  if (!channel) return response({ error: "Bu aktif channel'a katılmadınız." }, 403);
  await resolveDueMissions(user.id, channel.id, channel.name);
  const dayStart = agitationDayStart(Date.now(), channel.speed);
  const [rows, missions, defense, incoming, membership, sentToday] = await Promise.all([
    getDb().select({ userId: channelMembers.userId, gameState: gameSaves.gameState }).from(channelMembers).innerJoin(gameSaves, eq(gameSaves.userId, channelMembers.userId)).where(and(eq(channelMembers.channelId, channel.id), eq(channelMembers.status, "active"))).orderBy(channelMembers.joinedAt),
    getDb().select().from(intelMissions).where(and(eq(intelMissions.channelId, channel.id), eq(intelMissions.sourceUserId, user.id))).orderBy(desc(intelMissions.completesAt)),
    getDb().select().from(intelDefenses).where(eq(intelDefenses.userId, user.id)).limit(1),
    getDb().select({ id: intelMissions.id }).from(intelMissions).where(and(eq(intelMissions.channelId, channel.id), eq(intelMissions.targetUserId, user.id), eq(intelMissions.status, "detected"))).limit(10),
    getDb().select({ accepts: channelMembers.acceptsAgitation }).from(channelMembers).where(and(eq(channelMembers.userId, user.id), eq(channelMembers.channelId, channel.id))).limit(1),
    getDb().select({ total: count() }).from(agitations).where(and(eq(agitations.sourceUserId, user.id), gt(agitations.sentAt, dayStart))),
  ]);
  const latest = new Map<string, typeof missions[number]>();
  missions.forEach(mission => { if (!latest.has(mission.targetUserId)) latest.set(mission.targetUserId, mission); });
  // Yerleşim channel geneli üzerinden hesaplanır: her krallık seçtiği araziye ait
  // biyoma, katılım sırasına göre bir sonraki boş halkaya oturur.
  const snapshots = rows.flatMap(row => {
    const snapshot = projectPublicKingdom(row.userId, row.gameState, channel.name);
    return snapshot ? [snapshot] : [];
  });
  const layout = layoutChannel(channel.id, snapshots.map<MemberInput>(entry => ({ userId: entry.id, terrain: entry.terrain })));
  const home = layout.get(user.id) ?? { x: 0, z: 0, ring: 0, biome: "plain" as const };

  const now = Date.now();
  const kingdoms = snapshots.flatMap(snapshot => {
    if (snapshot.id === user.id) return [];
    const mission = latest.get(snapshot.id), discovered = mission?.status === "succeeded";
    let report: IntelReport | null = null;
    if (discovered && mission?.report) try { report = JSON.parse(mission.report) as IntelReport; } catch { report = null; }
    const placement = layout.get(snapshot.id) ?? { x: 0, z: 0, ring: 0, biome: snapshot.terrain };
    return [{
      id: snapshot.id,
      // Keşfedilmemiş krallığın adı ve kale seviyesi gizli kalır; yalnızca kalesi görünür.
      name: discovered ? snapshot.name : null,
      terrain: snapshot.terrain,
      position: { x: placement.x, z: placement.z },
      ring: placement.ring,
      discovered,
      mission: mission ? { status: mission.status, completesAt: mission.completesAt, successChance: mission.successChance } : null,
      report,
      // RAPORUN YAŞI. Keşif kalıcı, rapor ise donmuş bir anlık görüntü: ajanın
      // döndüğü an taşınır ki Kral altı gün önceki ordu sayısına taze veri gibi
      // bakmasın. Raporun tamamen sönmesi bir denge kararıdır ve Krala bırakıldı.
      reportAt: report && mission ? mission.completesAt : null,
      reportStale: report && mission ? isStaleReport(mission.completesAt, now) : false,
    }];
  });
  return response({ channel, kingdoms, home: { x: home.x, z: home.z, ring: home.ring, biome: home.biome }, extent: worldExtent([home, ...kingdoms.map(k => ({ x: k.position.x, z: k.position.z, ring: k.ring, biome: k.terrain as never }))]), minePosition: sharedMinePosition(), defense: { active: Boolean(defense[0]?.activeUntil && defense[0].activeUntil > Date.now()), activeUntil: defense[0]?.activeUntil ?? null }, incomingAlerts: incoming.length,
    // Dış kese: bedeli, günlük tavanı ve Kralın kendi opt-out durumu. Sabitler
    // motordan okunur; panel kendi kopyasını tutmaz.
    agitation: {
      accepts: membership[0]?.accepts !== false,
      cost: AGITATION.cost,
      sentToday: Number(sentToday[0]?.total ?? 0),
      perDay: AGITATION.perSenderPerDay,
    } });
}

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return response({ error: "Oturum gerekli." }, 401);
  const body = await request.json() as {
    action?: "scout" | "defend" | "agitate" | "set_agitation_opt";
    channelId?: string; targetId?: string;
    kind?: string; resource?: string; accepts?: boolean;
  };
  if (!body.channelId) return response({ error: "Channel gerekli." }, 400);
  const channel = await channelFor(user.id, body.channelId);
  if (!channel) return response({ error: "Bu aktif channel'a katılmadınız." }, 403);
  // Opt-out: `acceptsNegotiation` deseninin ikizi. Kral dış keseye kapanabilir;
  // taciz aracına dönüşmesine karşı ilk savunma hattı budur.
  if (body.action === "set_agitation_opt") {
    const accepts = body.accepts !== false;
    await getDb().update(channelMembers).set({ acceptsAgitation: accepts })
      .where(and(eq(channelMembers.userId, user.id), eq(channelMembers.channelId, channel.id)));
    return response({ acceptsAgitation: accepts });
  }
  if (body.action === "agitate") {
    if (!body.targetId) return response({ error: "Kese hedefi gerekli." }, 400);
    const kind = body.kind === "gold_garrison" ? "gold_garrison" as const
      : body.kind === "goods_glut" ? "goods_glut" as const
      : body.kind === "raid_lure" ? "raid_lure" as const : "gold_commons" as const;
    const resource = isTraded(String(body.resource)) ? String(body.resource) as TradeKey : "food";
    const outcome = await sendAgitation({
      channel, sourceUserId: user.id, targetUserId: body.targetId, kind, resource, now: Date.now(),
    });
    if (!outcome.ok) return response({ error: outcome.error }, outcome.status);
    return response({ sent: true, completesAt: outcome.completesAt, cost: outcome.cost, resource: outcome.resource });
  }
  if (body.action === "defend") {
    const activeUntil = Date.now() + 3_600_000;
    await getDb().insert(intelDefenses).values({ userId: user.id, level: 1, activeUntil }).onConflictDoUpdate({ target: intelDefenses.userId, set: { level: 1, activeUntil, updatedAt: sql`CURRENT_TIMESTAMP` } });
    return response({ defended: true, activeUntil });
  }
  if (body.action !== "scout" || !body.targetId || body.targetId === user.id) return response({ error: "Geçersiz keşif hedefi." }, 400);
  const [target] = await getDb().select({ userId: channelMembers.userId }).from(channelMembers).where(and(eq(channelMembers.userId, body.targetId), eq(channelMembers.channelId, channel.id), eq(channelMembers.status, "active"))).limit(1);
  if (!target) return response({ error: "Hedef bu channel'da değil." }, 404);
  const [recent] = await getDb().select().from(intelMissions).where(and(eq(intelMissions.sourceUserId, user.id), eq(intelMissions.targetUserId, target.userId))).orderBy(desc(intelMissions.completesAt)).limit(1);
  if (recent && recent.completesAt > Date.now() - 300_000) return response({ error: recent.status === "pending" ? "Ajan zaten yolda." : "Yeni ajan göndermek için beş dakika beklemelisiniz." }, 429);
  const [targetDefense] = await getDb().select().from(intelDefenses).where(eq(intelDefenses.userId, target.userId)).limit(1);
  const defended = Boolean(targetDefense?.activeUntil && targetDefense.activeUntil > Date.now()), successChance = defended ? 3 : 10, detectionChance = defended ? 75 : 30;
  const completesAt = Date.now() + Math.max(15_000, Math.round(90_000 / Math.max(1, channel.speed)));
  await getDb().insert(intelMissions).values({ id: crypto.randomUUID(), channelId: channel.id, sourceUserId: user.id, targetUserId: target.userId, successChance, detectionChance, completesAt });
  return response({ sent: true, completesAt, successChance });
}
