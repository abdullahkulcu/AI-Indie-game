import { and, count, desc, eq, gt, lte, ne, or, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { agitations, channelMembers, channels, diplomaticRelations, gameSaves, intelDefenses, intelMissions, sharedMines, spyNetworks } from "../../../db/schema";
import { currentUser } from "../../../server/account-auth";
import { channelAverages, channelVictoryStanding, deepIntelReportOf, intelReportOf, isStaleReport, projectPublicKingdom, type IntelReport } from "../../../server/world-projection";
import { sendAgitation } from "../../../server/agitation-desk";
import { AGITATION, agitationDayStart } from "../../../engine/agitation";
import { channelPriceIndex, isTraded } from "../../../engine/market";
import type { TradeKey } from "../../../engine/types";
import { intelligenceTerms, SPY_NETWORK, spyNetworkTravelMs, type IntelMissionKind } from "../../../engine/intelligence";
import { layoutChannel, sharedMinePosition, worldExtent, type MemberInput } from "../../../engine/world-map";
import { parseStoredSave } from "../../../server/save-validation";
import { writeSaveIfUnchanged } from "../../../server/save-write";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };
const response = (body: unknown, status = 200) => Response.json(body, { status, headers });

/**
 * Zafer skorunun kese defteri için okunan satır tavanı.
 *
 * Kese GÖNDERİMİ zaten sıkı tavanlı (gönderen başına oyun-günü 4, hedef başına
 * 3, çift arası 6 saat), yani uzun bir sezonda bile satır sayısı binlerle
 * ölçülür. Tavan yine de duruyor: bu sorgu her `GET /api/world` turunda (10
 * saniyede bir) koşuyor ve sınırsız bir SELECT'in maliyeti channel yaşıyla
 * birlikte sessizce büyürdü.
 */
const VICTORY_PURSE_LIMIT = 4000;

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
    const kind = mission.kind === "deep_observation" ? "deep_observation" : "scout";
    const report = succeeded && snapshot
      ? kind === "deep_observation"
        ? deepIntelReportOf(snapshot, save?.gameState ?? "")
        : intelReportOf(snapshot)
      : null;
    await getDb().update(intelMissions).set({ status, report: report ? JSON.stringify(report) : null, resolvedAt: sql`CURRENT_TIMESTAMP` }).where(and(eq(intelMissions.id, mission.id), eq(intelMissions.status, "pending")));
  }
}

/** Derin gözetleme ücreti, istemcinin bildirdiği kaynaktan değil kaydın taze sürümünden alınır. */
async function chargeDeepObservation(userId: string, goldCost: number, now: number) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [row] = await getDb().select({ gameState: gameSaves.gameState, revision: gameSaves.revision }).from(gameSaves).where(eq(gameSaves.userId, userId)).limit(1);
    const game = row ? parseStoredSave(row.gameState) : null;
    if (!row || !game) return false;
    if (game.resources.gold < goldCost) return false;
    const next = {
      ...game,
      resources: { ...game.resources, gold: game.resources.gold - goldCost },
      notices: [{ kind: "İSTİHBARAT", text: `Derin gözetleme için ${goldCost} altın ayrıldı; ajan halkın nabzını dinlemek üzere yolda.`, at: now }, ...game.notices].slice(0, 20),
    };
    if (await writeSaveIfUnchanged(userId, row.revision, next)) return true;
  }
  return false;
}

/** Kalıcı ağın bedelini düşer ve görevi aynı işlemde açar; ikisi ayrılamaz. */
async function deploySpyNetwork(input: {
  userId: string;
  channel: { id: string; name: string; speed: number };
  targetUserId: string;
  now: number;
}) {
  const db = getDb();
  const { userId, channel, targetUserId, now } = input;
  const [known] = await db.select({ id: intelMissions.id }).from(intelMissions).where(and(
    eq(intelMissions.channelId, channel.id), eq(intelMissions.sourceUserId, userId),
    eq(intelMissions.targetUserId, targetUserId), eq(intelMissions.status, "succeeded"),
  )).limit(1);
  if (!known) return { ok: false as const, status: 409, error: "Önce bu sancağı başarıyla keşfetmeniz gerekir; bilinmeyen bir yere ağ kurulamaz." };
  const [sourceRow] = await db.select().from(gameSaves).where(eq(gameSaves.userId, userId)).limit(1);
  const source = sourceRow ? parseStoredSave(sourceRow.gameState) : null;
  if (!source) return { ok: false as const, status: 409, error: "Krallık kaydı okunamadı; ağ kurulamadı." };
  if (source.resources.gold < SPY_NETWORK.goldCost) return { ok: false as const, status: 409, error: `Casus ağı için ${SPY_NETWORK.goldCost} altın gerekli.` };
  const deploysAt = now + spyNetworkTravelMs(channel.speed);
  const next = {
    ...source,
    resources: { ...source.resources, gold: source.resources.gold - SPY_NETWORK.goldCost },
    notices: [{ kind: "İSTİHBARAT", text: `Casus ağı için ${SPY_NETWORK.goldCost} altın ayrıldı; ajanlar hedef sancakta yerleşmek üzere yolda.`, at: now }, ...source.notices].slice(0, 20),
  };
  const result = await db.transaction(async tx => {
    const debited = await tx.update(gameSaves)
      .set({ gameState: JSON.stringify(next), revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(gameSaves.userId, userId), eq(gameSaves.revision, sourceRow!.revision)))
      .returning({ userId: gameSaves.userId });
    if (!debited.length) return "stale" as const;
    const opened = await tx.insert(spyNetworks).values({
      id: crypto.randomUUID(), channelId: channel.id, sourceUserId: userId, targetUserId,
      deploysAt,
    }).onConflictDoNothing().returning({ id: spyNetworks.id });
    if (!opened.length) { tx.rollback(); return "existing" as const; }
    return "ok" as const;
  }).catch(() => "existing" as const);
  if (result === "stale") return { ok: false as const, status: 409, error: "Krallık kaydı bu arada değişti; ağı tekrar kurun." };
  if (result !== "ok") return { ok: false as const, status: 409, error: "Bu hedefte zaten etkin ya da kurulmakta olan bir casus ağınız var." };
  return { ok: true as const, deploysAt, cost: SPY_NETWORK.goldCost };
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
  const [rows, missions, networks, defense, incoming, sentToday, purseRows, mineRows, relations] = await Promise.all([
    getDb().select({ userId: channelMembers.userId, gameState: gameSaves.gameState }).from(channelMembers).innerJoin(gameSaves, eq(gameSaves.userId, channelMembers.userId)).where(and(eq(channelMembers.channelId, channel.id), eq(channelMembers.status, "active"))).orderBy(channelMembers.joinedAt),
    getDb().select().from(intelMissions).where(and(eq(intelMissions.channelId, channel.id), eq(intelMissions.sourceUserId, user.id))).orderBy(desc(intelMissions.completesAt)),
    getDb().select().from(spyNetworks).where(and(eq(spyNetworks.channelId, channel.id), eq(spyNetworks.sourceUserId, user.id), or(eq(spyNetworks.status, "deploying"), eq(spyNetworks.status, "active"), eq(spyNetworks.status, "exposed")))).orderBy(desc(spyNetworks.createdAt)),
    getDb().select().from(intelDefenses).where(eq(intelDefenses.userId, user.id)).limit(1),
    getDb().select({ id: intelMissions.id }).from(intelMissions).where(and(eq(intelMissions.channelId, channel.id), eq(intelMissions.targetUserId, user.id), eq(intelMissions.status, "detected"))).limit(10),
    getDb().select({ total: count() }).from(agitations).where(and(eq(agitations.sourceUserId, user.id), gt(agitations.sentAt, dayStart))),
    // ZAFER SKORU: channel'ın kaderi belli olmuş bütün keseleri. Kralın kendi
    // defteri de sıralama da aynı satırlardan çıkar; komşuların skoru
    // hesaplanır ama İSTEMCİYE İNMEZ (bkz. server/world-projection.ts →
    // channelVictoryStanding).
    getDb().select({ sourceUserId: agitations.sourceUserId, targetUserId: agitations.targetUserId, status: agitations.status }).from(agitations).where(and(eq(agitations.channelId, channel.id), ne(agitations.status, "pending"))).limit(VICTORY_PURSE_LIMIT),
    getDb().select({ x: sharedMines.positionX, z: sharedMines.positionZ }).from(sharedMines).where(eq(sharedMines.channelId, channel.id)).limit(1),
    getDb().select({ targetUserId: diplomaticRelations.targetUserId, standing: diplomaticRelations.standing }).from(diplomaticRelations)
      .where(and(eq(diplomaticRelations.channelId, channel.id), eq(diplomaticRelations.sourceUserId, user.id))),
  ]);
  const latest = new Map<string, typeof missions[number]>();
  missions.forEach(mission => { if (!latest.has(mission.targetUserId)) latest.set(mission.targetUserId, mission); });
  const networkByTarget = new Map<string, typeof networks[number]>();
  networks.forEach(network => { if (!networkByTarget.has(network.targetUserId)) networkByTarget.set(network.targetUserId, network); });
  // Yerleşim channel geneli üzerinden hesaplanır: her krallık seçtiği araziye ait
  // biyoma, katılım sırasına göre bir sonraki boş halkaya oturur.
  const snapshots = rows.flatMap(row => {
    const snapshot = projectPublicKingdom(row.userId, row.gameState, channel.name);
    return snapshot ? [snapshot] : [];
  });
  const layout = layoutChannel(channel.id, snapshots.map<MemberInput>(entry => ({ userId: entry.id, terrain: entry.terrain })));
  const home = layout.get(user.id) ?? { x: 0, z: 0, ring: 0, biome: "plain" as const };

  const now = Date.now();
  const relationByTarget = new Map(relations.map(relation => [relation.targetUserId, relation.standing]));
  const kingdoms = snapshots.flatMap(snapshot => {
    if (snapshot.id === user.id) return [];
    const mission = latest.get(snapshot.id), network = networkByTarget.get(snapshot.id), discovered = mission?.status === "succeeded";
    let report: IntelReport | null = null;
    if (network?.latestReport) try { report = JSON.parse(network.latestReport) as IntelReport; } catch { report = null; }
    if (!report && discovered && mission?.report) try { report = JSON.parse(mission.report) as IntelReport; } catch { report = null; }
    const placement = layout.get(snapshot.id) ?? { x: 0, z: 0, ring: 0, biome: snapshot.terrain };
    return [{
      id: snapshot.id,
      // Keşfedilmemiş krallığın adı ve kale seviyesi gizli kalır; yalnızca kalesi görünür.
      name: discovered ? snapshot.name : null,
      terrain: snapshot.terrain,
      position: { x: placement.x, z: placement.z },
      ring: placement.ring,
      discovered,
      mission: mission ? { status: mission.status, completesAt: mission.completesAt, successChance: mission.successChance, kind: mission.kind } : null,
      network: network ? { status: network.status, deploysAt: network.deploysAt, nextReportAt: network.nextReportAt, exposedAt: network.exposedAt } : null,
      report,
      // RAPORUN YAŞI. Keşif kalıcı, rapor ise donmuş bir anlık görüntü: ajanın
      // döndüğü an taşınır ki Kral altı gün önceki ordu sayısına taze veri gibi
      // bakmasın. Raporun tamamen sönmesi bir denge kararıdır ve Krala bırakıldı.
      reportAt: report ? (network?.lastReportAt ?? mission?.completesAt ?? null) : null,
      reportStale: report ? network?.status === "active" ? false : isStaleReport(network?.lastReportAt ?? mission?.completesAt ?? now, now) : false,
      relation: relationByTarget.get(snapshot.id) ?? 0,
    }];
  });
  const compare = channelAverages({ channelName: channel.name, excludeUserId: user.id, rows, now });
  return response({ channel, kingdoms, home: { x: home.x, z: home.z, ring: home.ring, biome: home.biome }, extent: worldExtent([home, ...kingdoms.map(k => ({ x: k.position.x, z: k.position.z, ring: k.ring, biome: k.terrain as never }))]), minePosition: mineRows[0] ? { x: mineRows[0].x, z: mineRows[0].z } : sharedMinePosition(), defense: { active: Boolean(defense[0]?.activeUntil && defense[0].activeUntil > Date.now()), activeUntil: defense[0]?.activeUntil ?? null }, incomingAlerts: incoming.length,
    // KIYAS: channel'ın anonim ortalaması. Yukarıdaki `rows` sorgusu channel'ın
    // tüm aktif üyelerini zaten okuduğu için ikinci bir DB turu yok; kimin hangi
    // değere sahip olduğu istemciye inmez, yalnızca ortalama iner (ve aday
    // sayısı gizlilik alt sınırının altındaysa o bile inmez).
    compare,
    /**
     * CHANNEL PAZAR ENDEKSİ (plan belgesi Fikir 24) — komşuların açık emir
     * akışının yerel fiyata sızması.
     *
     * NEDEN BURADAN ÇIKIYOR: endeks SUNUCU-TÜREVİDİR ve kaydın içinde
     * DURMAZ. Kayda konsaydı istemci onu bildirir ve `commons` istismarının
     * aynısı doğardı (bkz. server/save-validation.ts, "HALKIN DEFTERİ
     * SUNUCUNUN"): Kral endeksi kendi lehine bildirip fiyatı kırar/şişirirdi.
     * Burada hesaplanıp SALT OKUNUR olarak inince istemcinin bildirebileceği
     * bir alan hiç var olmuyor — istismar kapısı açılmadan kapanıyor.
     *
     * Yukarıdaki `rows` sorgusu channel'ın bütün aktif kayıtlarını ZATEN
     * okuduğu için ikinci bir DB turu yok; toplamlar `channelAverages`'ın
     * kendi döngüsünden geliyor (kararı gereği bağımsız bir agregasyon
     * kurulmadı). Kimin ne emri verdiği İNMEZ, yalnızca mal başına tek bir
     * çarpan iner ve o da gizlilik alt sınırının altında hiç üretilmez.
     */
    marketIndex: compare.market
      ? channelPriceIndex({ ...compare.market, channelSpeed: channel.speed })
      : null,
    // Dış kese: gelen faaliyetler kapatılamaz. Savunma, karşı-istihbarat ile
    // etki azaltma ve ifşa üzerinden yürür. Sabitler motordan okunur.
    agitation: {
      cost: AGITATION.cost,
      sentToday: Number(sentToday[0]?.total ?? 0),
      perDay: AGITATION.perSenderPerDay,
    },
    // ZAFER SKORU: yalnızca KENDİ kese defterimiz ve (gizlilik alt sınırı
    // sağlanıyorsa) sıramız iner. Skorun kendisini arayüz canlı oyun
    // durumundan aynı motor fonksiyonuyla hesaplar (engine/victory.ts).
    victory: channelVictoryStanding({
      channelName: channel.name, userId: user.id, rows, now,
      // `ne(status,"pending")` süzgeci SQL'de uygulandı; tip daralması burada
      // yapılır ki motora "pending" değeri taşıyan bir satır hiç geçmesin.
      purses: purseRows.flatMap(row => row.status === "pending" ? [] : [{ sourceUserId: row.sourceUserId, targetUserId: row.targetUserId, status: row.status }]),
    }) });
}

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return response({ error: "Oturum gerekli." }, 401);
  const body = await request.json() as {
    action?: "scout" | "deep_observation" | "spy_network" | "defend" | "agitate";
    channelId?: string; targetId?: string;
    kind?: string; resource?: string;
  };
  if (!body.channelId) return response({ error: "Channel gerekli." }, 400);
  const channel = await channelFor(user.id, body.channelId);
  if (!channel) return response({ error: "Bu aktif channel'a katılmadınız." }, 403);
  if (body.action === "agitate") {
    if (!body.targetId) return response({ error: "Kese hedefi gerekli." }, 400);
    const kind = body.kind === "support_movement" ? "support_movement" as const
      : body.kind === "gold_garrison" ? "gold_garrison" as const
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
  if (body.action === "spy_network") {
    if (!body.targetId || body.targetId === user.id) return response({ error: "Geçersiz casus ağı hedefi." }, 400);
    const [target] = await getDb().select({ userId: channelMembers.userId }).from(channelMembers)
      .where(and(eq(channelMembers.userId, body.targetId), eq(channelMembers.channelId, channel.id), eq(channelMembers.status, "active"))).limit(1);
    if (!target) return response({ error: "Hedef bu channel'da değil." }, 404);
    const outcome = await deploySpyNetwork({ userId: user.id, channel, targetUserId: target.userId, now: Date.now() });
    if (!outcome.ok) return response({ error: outcome.error }, outcome.status);
    return response({ sent: true, deploysAt: outcome.deploysAt, cost: outcome.cost, kind: "spy_network" });
  }
  const kind: IntelMissionKind | null = body.action === "scout" ? "scout" : body.action === "deep_observation" ? "deep_observation" : null;
  if (!kind || !body.targetId || body.targetId === user.id) return response({ error: "Geçersiz keşif hedefi." }, 400);
  const [target] = await getDb().select({ userId: channelMembers.userId }).from(channelMembers).where(and(eq(channelMembers.userId, body.targetId), eq(channelMembers.channelId, channel.id), eq(channelMembers.status, "active"))).limit(1);
  if (!target) return response({ error: "Hedef bu channel'da değil." }, 404);
  const [recent] = await getDb().select().from(intelMissions).where(and(eq(intelMissions.sourceUserId, user.id), eq(intelMissions.targetUserId, target.userId))).orderBy(desc(intelMissions.completesAt)).limit(1);
  if (recent && recent.completesAt > Date.now() - 300_000) return response({ error: recent.status === "pending" ? "Ajan zaten yolda." : "Yeni ajan göndermek için beş dakika beklemelisiniz." }, 429);
  const [targetDefense] = await getDb().select().from(intelDefenses).where(eq(intelDefenses.userId, target.userId)).limit(1);
  const now = Date.now();
  const defended = Boolean(targetDefense?.activeUntil && targetDefense.activeUntil > now);
  const terms = intelligenceTerms(kind, defended);
  const completesAt = now + Math.max(15_000, Math.round((90_000 * terms.durationMultiplier) / Math.max(1, channel.speed)));
  const id = crypto.randomUUID();
  try {
    await getDb().insert(intelMissions).values({ id, channelId: channel.id, sourceUserId: user.id, targetUserId: target.userId, kind, successChance: terms.successChance, detectionChance: terms.detectionChance, completesAt });
  } catch {
    // Kısmi benzersiz indeks iki eşzamanlı ajan emrinden yalnız birini kabul eder.
    return response({ error: "Bu hedefe zaten bir ajan yolda." }, 409);
  }
  if (terms.goldCost > 0 && !(await chargeDeepObservation(user.id, terms.goldCost, now))) {
    // Para taze kayıttan alınamadıysa görev de doğmamış sayılır; bedelsiz ajan kalmaz.
    await getDb().delete(intelMissions).where(eq(intelMissions.id, id));
    return response({ error: `Derin gözetleme için ${terms.goldCost} altın gerekli.` }, 409);
  }
  return response({ sent: true, completesAt, successChance: terms.successChance, cost: terms.goldCost, kind });
}
