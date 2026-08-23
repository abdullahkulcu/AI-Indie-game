import { and, count, desc, eq, gt, lte, ne, or, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { agitations, channelMembers, channels, gameSaves, intelDefenses, intelMissions } from "../../../db/schema";
import { currentUser } from "../../../server/account-auth";
import { channelAverages, channelVictoryStanding, intelReportOf, isStaleReport, moodLabelOf, projectPublicKingdom, type IntelReport } from "../../../server/world-projection";
import { sendAgitation } from "../../../server/agitation-desk";
import { parseStoredSave } from "../../../server/save-validation";
import { AGITATION, agitationDayStart } from "../../../engine/agitation";
import { channelPriceIndex, isTraded } from "../../../engine/market";
import { INTEL_MISSIONS, intelChances, intelTravelMs, resolveIntelMission, type IntelMissionKind } from "../../../engine/intel";
import type { Game, TradeKey } from "../../../engine/types";
import { layoutChannel, sharedMinePosition, worldExtent, type MemberInput } from "../../../engine/world-map";

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
    // ZAR: tohumlu (engine/intel.ts → resolveIntelMission). Tohumun öngörülemez
    // parçası SUNUCUDA üretilen görev kimliğidir; istemci onu hiç görmediği için
    // Kral sonucu önceden hesaplayıp "kazanan turda" ajan yollayamaz.
    const { succeeded, status } = resolveIntelMission({
      missionId: mission.id, successChance: mission.successChance,
      detectionChance: mission.detectionChance, hasSnapshot: Boolean(snapshot),
    });
    // Raporun NE İÇERDİĞİ tek yerde kararlaşır (server/world-projection.ts →
    // intelReportOf). Eskiden anlık görüntünün tamamı yazılıyordu ve karşı
    // krallığın AMBARI raporun içinde istemciye iniyordu.
    //
    // DERİN GÖZETLEME (Fikir 5): moral etiketi YALNIZCA `deep` türü bir görev
    // başarıya ulaşırsa hesaplanır. Standart keşifte `moodLabelOf` hiç
    // çağrılmaz, yani etiketin sızabileceği ikinci bir yol yok.
    const mood = succeeded && mission.kind === "deep" && save ? moodLabelOf(save.gameState, channelName) : null;
    await getDb().update(intelMissions).set({ status, report: succeeded && snapshot ? JSON.stringify(intelReportOf(snapshot, mood)) : null, resolvedAt: sql`CURRENT_TIMESTAMP` }).where(and(eq(intelMissions.id, mission.id), eq(intelMissions.status, "pending")));
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
  const [rows, missions, defense, incoming, membership, sentToday, purseRows] = await Promise.all([
    getDb().select({ userId: channelMembers.userId, gameState: gameSaves.gameState }).from(channelMembers).innerJoin(gameSaves, eq(gameSaves.userId, channelMembers.userId)).where(and(eq(channelMembers.channelId, channel.id), eq(channelMembers.status, "active"))).orderBy(channelMembers.joinedAt),
    getDb().select().from(intelMissions).where(and(eq(intelMissions.channelId, channel.id), eq(intelMissions.sourceUserId, user.id))).orderBy(desc(intelMissions.completesAt)),
    getDb().select().from(intelDefenses).where(eq(intelDefenses.userId, user.id)).limit(1),
    getDb().select({ id: intelMissions.id }).from(intelMissions).where(and(eq(intelMissions.channelId, channel.id), eq(intelMissions.targetUserId, user.id), eq(intelMissions.status, "detected"))).limit(10),
    getDb().select({ accepts: channelMembers.acceptsAgitation }).from(channelMembers).where(and(eq(channelMembers.userId, user.id), eq(channelMembers.channelId, channel.id))).limit(1),
    getDb().select({ total: count() }).from(agitations).where(and(eq(agitations.sourceUserId, user.id), gt(agitations.sentAt, dayStart))),
    // ZAFER SKORU: channel'ın kaderi belli olmuş bütün keseleri. Kralın kendi
    // defteri de sıralama da aynı satırlardan çıkar; komşuların skoru
    // hesaplanır ama İSTEMCİYE İNMEZ (bkz. server/world-projection.ts →
    // channelVictoryStanding).
    getDb().select({ sourceUserId: agitations.sourceUserId, targetUserId: agitations.targetUserId, status: agitations.status }).from(agitations).where(and(eq(agitations.channelId, channel.id), ne(agitations.status, "pending"))).limit(VICTORY_PURSE_LIMIT),
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
      mission: mission ? { status: mission.status, completesAt: mission.completesAt, successChance: mission.successChance, kind: mission.kind } : null,
      report,
      // RAPORUN YAŞI. Keşif kalıcı, rapor ise donmuş bir anlık görüntü: ajanın
      // döndüğü an taşınır ki Kral altı gün önceki ordu sayısına taze veri gibi
      // bakmasın. Raporun tamamen sönmesi bir denge kararıdır ve Krala bırakıldı.
      reportAt: report && mission ? mission.completesAt : null,
      reportStale: report && mission ? isStaleReport(mission.completesAt, now) : false,
    }];
  });
  const compare = channelAverages({ channelName: channel.name, excludeUserId: user.id, rows, now });
  return response({ channel, kingdoms, home: { x: home.x, z: home.z, ring: home.ring, biome: home.biome }, extent: worldExtent([home, ...kingdoms.map(k => ({ x: k.position.x, z: k.position.z, ring: k.ring, biome: k.terrain as never }))]), minePosition: sharedMinePosition(), defense: { active: Boolean(defense[0]?.activeUntil && defense[0].activeUntil > Date.now()), activeUntil: defense[0]?.activeUntil ?? null }, incomingAlerts: incoming.length,
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
    /**
     * DERİN GÖZETLEMENİN BEDELİ (Fikir 5). Panel bu sayıyı SABİT KODLAMASIN:
     * bedel motorda tek kaynakta (engine/intel.ts → INTEL_MISSIONS) yaşıyor ve
     * arayüz onu buradan okuyor — dış kesenin `agitation.cost` alanıyla aynı
     * disiplin. Sunucu bedeli yine kendi tablosundan okur, istemcinin
     * bildirdiği hiçbir sayıya bakmaz.
     */
    intel: { deepCost: INTEL_MISSIONS.deep.goldCost },
    // Dış kese: bedeli, günlük tavanı ve Kralın kendi opt-out durumu. Sabitler
    // motordan okunur; panel kendi kopyasını tutmaz.
    agitation: {
      accepts: membership[0]?.accepts !== false,
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
    action?: "scout" | "deep_scout" | "defend" | "agitate" | "set_agitation_opt";
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
  // İki görev türü aynı kapıdan geçer: `scout` (bedava keşif) ve `deep_scout`
  // (DERİN GÖZETLEME — plan belgesi Fikir 5). Bekleme süresi, tek-ajan kuralı
  // ve hedef doğrulaması ikisinde de AYNI; ayrılan tek şey bedel/ihtimal/süre
  // ve o tablo motorda tek kaynakta duruyor (engine/intel.ts).
  const kind: IntelMissionKind | null = body.action === "scout" ? "scout" : body.action === "deep_scout" ? "deep" : null;
  if (!kind || !body.targetId || body.targetId === user.id) return response({ error: "Geçersiz keşif hedefi." }, 400);
  const [target] = await getDb().select({ userId: channelMembers.userId }).from(channelMembers).where(and(eq(channelMembers.userId, body.targetId), eq(channelMembers.channelId, channel.id), eq(channelMembers.status, "active"))).limit(1);
  if (!target) return response({ error: "Hedef bu channel'da değil." }, 404);
  const [recent] = await getDb().select().from(intelMissions).where(and(eq(intelMissions.sourceUserId, user.id), eq(intelMissions.targetUserId, target.userId))).orderBy(desc(intelMissions.completesAt)).limit(1);
  if (recent && recent.completesAt > Date.now() - 300_000) return response({ error: recent.status === "pending" ? "Ajan zaten yolda." : "Yeni ajan göndermek için beş dakika beklemelisiniz." }, 429);
  const [targetDefense] = await getDb().select().from(intelDefenses).where(eq(intelDefenses.userId, target.userId)).limit(1);
  const defended = Boolean(targetDefense?.activeUntil && targetDefense.activeUntil > Date.now());
  const { successChance, detectionChance } = intelChances(kind, defended);
  const now = Date.now();
  const completesAt = now + intelTravelMs(kind, channel.speed);
  const missionId = crypto.randomUUID();
  const goldCost = INTEL_MISSIONS[kind].goldCost;

  /**
   * BEDEL — dış kesenin (server/agitation-desk.ts) omurgasının aynısı: altın
   * GÖNDERENİN SUNUCUDAKİ kaydından, sürüm korumalı ve görev satırıyla TEK
   * İŞLEMDE düşer.
   *
   * İSTİSMAR NOTU: hazine istemcinin bildirdiği sayıdan değil, sunucudaki
   * kayıttan okunur (`parseStoredSave`) — istemci "altınım var" diyerek bedavaya
   * ajan yollayamaz. İki işi ayrı ayrı yapmak da olmazdı: biri geçip diğeri
   * düşerse ya bedava derin gözetleme yapılmış ya da altın hiçbir yere gitmeden
   * yok olmuş olurdu.
   */
  if (goldCost > 0) {
    const [row] = await getDb().select().from(gameSaves).where(eq(gameSaves.userId, user.id)).limit(1);
    const save = row ? parseStoredSave(row.gameState) : null;
    if (!row || !save) return response({ error: "Krallık kaydı okunamadı; ajan yollanamadı." }, 409);
    if (save.resources.gold < goldCost) {
      return response({ error: `Derin gözetleme ${goldCost} altın; hazinede ${Math.floor(save.resources.gold)} var.` }, 409);
    }
    const next: Game = {
      ...(save as Game),
      resources: { ...save.resources, gold: save.resources.gold - goldCost },
      notices: [{ kind: "İSTİHBARAT", text: `${goldCost} altın karşılığında komşu sancağın sokaklarına derin gözetleme ajanı yollandı.`, at: now }, ...save.notices].slice(0, 20),
    };
    const sent = await getDb().transaction(async trx => {
      const debited = await trx.update(gameSaves)
        .set({ gameState: JSON.stringify(next), revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(gameSaves.userId, user.id), eq(gameSaves.revision, row.revision)))
        .returning({ userId: gameSaves.userId });
      if (!debited.length) return "stale" as const;
      // Aynı hedefe ikinci ajanı DB'deki kısmi UNIQUE index reddeder; yarışan
      // istek burada, veritabanında durur ve altın da geri alınır.
      const opened = await trx.insert(intelMissions).values({ id: missionId, channelId: channel.id, sourceUserId: user.id, targetUserId: target.userId, kind, successChance, detectionChance, completesAt }).onConflictDoNothing().returning({ id: intelMissions.id });
      if (!opened.length) { trx.rollback(); return "pending" as const; }
      return "ok" as const;
    }).catch(() => "pending" as const);
    if (sent === "stale") return response({ error: "Krallık kaydı bu arada değişti; ajanı tekrar yollayın." }, 409);
    if (sent !== "ok") return response({ error: "Ajan zaten yolda." }, 429);
    return response({ sent: true, completesAt, successChance, kind, cost: goldCost });
  }

  await getDb().insert(intelMissions).values({ id: missionId, channelId: channel.id, sourceUserId: user.id, targetUserId: target.userId, kind, successChance, detectionChance, completesAt });
  return response({ sent: true, completesAt, successChance, kind, cost: 0 });
}
