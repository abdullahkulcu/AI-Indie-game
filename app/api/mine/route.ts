import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { channelMembers, channels, gameSaves, sharedMineInfluence, sharedMines, sharedMineWorkers } from "../../../db/schema";
import { currentUser } from "../../../server/account-auth";
import { projectPublicKingdom } from "../../../server/world-projection";
import { CAPS, parseStoredSave } from "../../../server/save-validation";
import { writeSaveIfUnchanged } from "../../../server/save-write";
import { MINE_ELAPSED_CAP_HOURS, MINE_INFLUENCE_WINDOW_HOURS, MINE_TICK_MIN_MS, SHARED_MINE_ORE_CAPACITY, advanceMineInfluence, mineSiteFor, oreRate, settleMine } from "../../../engine/mine";
import { isCurrentMineCrew } from "../../../server/mine-roster";

/** Madende çalışabilecek halkın oranı ve channel genelindeki toplam yuva. */
const PERSONAL_SHARE = .2;
const PERSONAL_FLOOR = 3;
const CHANNEL_SLOTS = 60;

/** Oyuncunun kaç işçi ayırabileceği kendi nüfusundan türer; sabit bir sayı değil. */
function personalCap(gameState: string | undefined) {
  const game = gameState ? parseStoredSave(gameState) : null;
  if (!game) return { cap: PERSONAL_FLOOR, population: 0 };
  return { cap: Math.max(PERSONAL_FLOOR, Math.floor(game.population * PERSONAL_SHARE)), population: Math.round(game.population) };
}

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };
const response = (body: unknown, status = 200) => Response.json(body, { status, headers });

async function context(userId: string, channelId: string) {
  const [channel] = await getDb().select({ id: channels.id, name: channels.name, speed: channels.speed }).from(channels).where(and(eq(channels.id, channelId), eq(channels.status, "active"))).limit(1);
  if (!channel) return null;
  const [member] = await getDb().select().from(channelMembers).where(and(eq(channelMembers.userId, userId), eq(channelMembers.channelId, channel.id), eq(channelMembers.status, "active"))).limit(1);
  if (!member) return null;
  const id = `mine:${channel.id}`;
  const site = mineSiteFor(channel.id, 0);
  await getDb().insert(sharedMines).values({
    id, channelId: channel.id, name: site.name, vein: site.vein,
    positionX: site.position.x, positionZ: site.position.z, lastTickAt: Date.now(),
  }).onConflictDoNothing();
  const [mine] = await getDb().select().from(sharedMines).where(eq(sharedMines.id, id)).limit(1);
  return mine ? { channel, mine } : null;
}

/**
 * Cevheri oyuncunun ambarına yazar.
 *
 * Oyun istemci-otoritatif (istemci `tick()` atıp bütün durumu PUT /api/save ile
 * gönderiyor), sunucu denetçidir. İstemciye "madenden 500 demir aldım" dedirtsek
 * bunu doğrulayacak bir dayanağımız kalmazdı; bu yüzden cevheri SUNUCU yazar —
 * haraç ödemelerindeki desenin aynısı. Böylece cevher, istemcinin bir sonraki
 * kaydı denetlenirken zaten `previous`ın içindedir ve `checkAgainstSimulation`
 * tavanı kendiliğinden doğru kalır.
 *
 * Yazma sürüm korumalıdır: Kral bu arada oynadıysa ilerlemesini ezmeyiz, taze
 * durumun üstüne bir kez daha deneriz. O da tutmazsa `false` döner ve cevher
 * `pendingOre` içinde bekler — kaybolmaz.
 */
async function deliverOre(userId: string, ore: number, mineName: string, now: number) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [row] = await getDb().select().from(gameSaves).where(eq(gameSaves.userId, userId)).limit(1);
    const game = row ? parseStoredSave(row.gameState) : null;
    if (!row || !game) return false;
    const next = {
      ...game,
      resources: { ...game.resources, iron: Math.min(CAPS.resource, game.resources.iron + ore) },
      notices: [{ kind: "MADEN", text: `${mineName}: madencileriniz ${ore} cevher çıkardı, ambara indirildi.`, at: now }, ...game.notices].slice(0, 20),
    };
    if (await writeSaveIfUnchanged(userId, row.revision, next)) return true;
  }
  return false;
}

/**
 * Maden emri ve damar tükenmesi sonrasında işçilerin durumunu sunucu kaydına
 * yazar. `mineWorkers` üretimi doğrudan etkilediği için yalnız tarayıcıdaki
 * sayıyı değiştirmek, eski sekmenin işçileri hayalet gibi madende tutmasına
 * neden olurdu.
 */
async function setMineWorkers(userId: string, workers: number, notice: string | null = null, now = Date.now()) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [row] = await getDb().select().from(gameSaves).where(eq(gameSaves.userId, userId)).limit(1);
    const game = row ? parseStoredSave(row.gameState) : null;
    if (!row || !game) return false;
    const next = {
      ...game,
      mineWorkers: Math.max(0, Math.floor(workers)),
      notices: notice
        ? [{ kind: "MADEN", text: notice, at: now }, ...game.notices].slice(0, 20)
        : game.notices,
    };
    if (await writeSaveIfUnchanged(userId, row.revision, next)) return true;
  }
  return false;
}

type MineTransition = { previousName: string; nextName: string; message: string };
type MineTick = typeof sharedMines.$inferSelect & { totalWorkers: number; renewal?: MineTransition };

/**
 * Channel değiştiren ya da kaydı artık okunamayan hesapların eski maden
 * satırlarını kapasite hesabından çıkarır. Önceden bu satırlar Diyar panelinde
 * görünmüyor, ama yine de 60 yuvayı doldurmuş sayılıyordu.
 */
async function currentMineCrew(mine: typeof sharedMines.$inferSelect, now: number) {
  const db = getDb();
  const crew = await db.select().from(sharedMineWorkers).where(eq(sharedMineWorkers.mineId, mine.id));
  if (!crew.length) return crew;
  const userIds = crew.map(row => row.userId);
  const [members, saves] = await Promise.all([
    db.select({ userId: channelMembers.userId }).from(channelMembers).where(and(
      eq(channelMembers.channelId, mine.channelId),
      eq(channelMembers.status, "active"),
      inArray(channelMembers.userId, userIds),
    )),
    db.select({ userId: gameSaves.userId, gameState: gameSaves.gameState }).from(gameSaves).where(inArray(gameSaves.userId, userIds)),
  ]);
  const activeUsers = new Set(members.map(row => row.userId));
  const gameByUser = new Map(saves.map(row => [row.userId, parseStoredSave(row.gameState)]));
  const stale = crew.filter(row => !isCurrentMineCrew({
    activeMembership: activeUsers.has(row.userId),
    mineChannelId: mine.channelId,
    game: gameByUser.get(row.userId) ?? null,
  }));
  if (!stale.length) return crew;

  const staleIds = stale.map(row => row.userId);
  await db.delete(sharedMineWorkers).where(and(eq(sharedMineWorkers.mineId, mine.id), inArray(sharedMineWorkers.userId, staleIds)));
  // Bu işçiler yerel üretimden de düşülüyordu. Satırları kaldırırken bu
  // sunucu-türetilmiş alanı da düzeltiriz; eski channel'ın hayalet ekibi
  // krallığın ekonomisini artık yavaşlatmaz.
  await Promise.all(staleIds.map(userId => setMineWorkers(
    userId,
    0,
    "Önceki channel'daki maden görevi kapatıldı; işçiler köylerine döndü.",
    now,
  )));
  return crew.filter(row => !staleIds.includes(row.userId));
}

/**
 * Son cevher de teslim edildikten sonra aynı channel'da yeni bir damar açar.
 * Eski ekip otomatik olarak köylerine döner; yeni sahaya işçi göndermek bilinçli
 * bir Kral kararıdır. Böylece tükenmiş sahada üretim sonsuza dek donmaz ve
 * işçiler yerel üretimden haksız yere eksik kalmaz.
 */
async function renewDepletedMine(mine: typeof sharedMines.$inferSelect, crew: Array<typeof sharedMineWorkers.$inferSelect>, now: number) {
  if (mine.oreRemaining > 0) return null;
  const nextSite = mineSiteFor(mine.channelId, mine.vein + 1);
  const [renewed] = await getDb().update(sharedMines)
    .set({
      name: nextSite.name,
      vein: nextSite.vein,
      positionX: nextSite.position.x,
      positionZ: nextSite.position.z,
      oreRemaining: SHARED_MINE_ORE_CAPACITY,
      extractedOre: 0,
      lastTickAt: now,
      influenceOwnerId: null,
      influenceGameHours: 0,
    })
    // İki sekme aynı son cevheri gördüğünde yalnız onu gerçekten tüketen istek
    // sahayı yeniler. Diğer istek yeni damarı olduğu gibi okur.
    .where(and(eq(sharedMines.id, mine.id), eq(sharedMines.vein, mine.vein), eq(sharedMines.oreRemaining, 0)))
    .returning();
  if (!renewed) return null;

  await getDb().delete(sharedMineWorkers).where(eq(sharedMineWorkers.mineId, mine.id));
  await getDb().delete(sharedMineInfluence).where(eq(sharedMineInfluence.mineId, mine.id));
  const message = `${mine.name} tükendi; işçiler köylerine döndü. ${renewed.name} Diyar haritasında bulundu, yeniden işçi gönderebilirsiniz.`;
  await Promise.all(crew.map(worker => setMineWorkers(worker.userId, 0, message, now)));
  return { previousName: mine.name, nextName: renewed.name, message } satisfies MineTransition;
}

/**
 * Madeni `now` anına kadar ilerletir: payları hesaplar, damardan düşer ve
 * teslim edilebilen cevheri oyuncuların kayıtlarına yazar.
 *
 * Pencere KOŞULLU yazma ile kapatılır (`lastTickAt` eşitliği): aynı anda düşen
 * iki istek — iki sekme, iki oyuncunun yoklaması — aynı cevheri iki kez
 * dağıtamaz. Kaybeden istek üretim yapmadan madenin taze hâlini döner.
 */
async function tickMine(mine: typeof sharedMines.$inferSelect, speed: number, options: { now: number; forceUserId?: string | null } = { now: Date.now() }): Promise<MineTick> {
  const now = options.now;
  const crew = await currentMineCrew(mine, now);
  const totalWorkers = crew.reduce((total, row) => total + row.workers, 0);
  // Panel 10 saniyede bir yokluyor; her yoklamada bütün ekibi yazmayız. Geçen
  // süre `lastTickAt` üzerinde bekler, hiçbir cevher kaybolmaz.
  // Tükenmiş damar, normal üretim penceresini beklemez: ilk gören Kral için
  // aynı istekte yeni saha açılır. Dolu damarlar yazma fırtınasına karşı eşiği
  // kullanmaya devam eder.
  if (!options.forceUserId && mine.oreRemaining > 0 && now - mine.lastTickAt < MINE_TICK_MIN_MS) return { ...mine, totalWorkers };
  const elapsedHours = Math.max(0, Math.min(MINE_ELAPSED_CAP_HOURS, (now - mine.lastTickAt) / 3_600_000));
  const samples = await getDb().select().from(sharedMineInfluence).where(eq(sharedMineInfluence.mineId, mine.id));
  const influence = advanceMineInfluence({
    crew: crew.map(row => ({ userId: row.userId, workers: row.workers })),
    samples: samples.map(row => ({ userId: row.userId, workerHours: row.workerHours })),
    gameHours: mine.influenceGameHours,
    elapsedGameHours: elapsedHours * speed,
    ownerUserId: mine.influenceOwnerId,
  });
  const settlement = settleMine(
    crew.map(row => ({ userId: row.userId, workers: row.workers, pendingOre: row.pendingOre, lastDeliveryAt: row.lastDeliveryAt })),
    { speed, hours: elapsedHours, oreRemaining: mine.oreRemaining, now, forceUserId: options.forceUserId ?? null, influenceOwnerId: mine.influenceOwnerId },
  );

  const claimed = await getDb().update(sharedMines)
    .set({
      lastTickAt: now,
      oreRemaining: mine.oreRemaining - settlement.extracted,
      extractedOre: mine.extractedOre + settlement.extracted,
      influenceOwnerId: influence.ownerUserId,
      influenceGameHours: influence.gameHours,
    })
    .where(and(eq(sharedMines.id, mine.id), eq(sharedMines.lastTickAt, mine.lastTickAt)))
    .returning({ id: sharedMines.id });
  if (!claimed.length) {
    const [fresh] = await getDb().select().from(sharedMines).where(eq(sharedMines.id, mine.id)).limit(1);
    return { ...(fresh ?? mine), totalWorkers };
  }

  // Pencere defteri işçi satırlarından ayrıdır: işçisini geri çeken Kral,
  // geçen saatlerdeki emeğini silerek liderlik yarışını değiştiremez.
  await getDb().delete(sharedMineInfluence).where(eq(sharedMineInfluence.mineId, mine.id));
  if (influence.samples.length) {
    await getDb().insert(sharedMineInfluence).values(influence.samples.map(sample => ({
      mineId: mine.id, userId: sample.userId, workerHours: sample.workerHours,
    })));
  }

  let returned = 0;
  for (const share of settlement.shares) {
    await getDb().update(sharedMineWorkers)
      .set(share.delivered > 0
        ? { pendingOre: share.pendingOre, deliveredOre: sql`${sharedMineWorkers.deliveredOre} + ${share.delivered}`, lastDeliveryAt: now }
        : { pendingOre: share.pendingOre })
      .where(and(eq(sharedMineWorkers.mineId, mine.id), eq(sharedMineWorkers.userId, share.userId)));
    if (share.delivered <= 0) continue;
    if (await deliverOre(share.userId, share.delivered, mine.name, now)) continue;
    // Kayda yazılamadı: cevher bekleyen paya geri konur ve damara iade edilir.
    // İki defter birlikte geri alınmazsa cevher ortadan kaybolur.
    returned += share.delivered;
    await getDb().update(sharedMineWorkers)
      .set({ pendingOre: sql`${sharedMineWorkers.pendingOre} + ${share.delivered}`, deliveredOre: sql`${sharedMineWorkers.deliveredOre} - ${share.delivered}` })
      .where(and(eq(sharedMineWorkers.mineId, mine.id), eq(sharedMineWorkers.userId, share.userId)));
  }
  if (returned > 0) {
    await getDb().update(sharedMines)
      .set({ oreRemaining: sql`${sharedMines.oreRemaining} + ${returned}`, extractedOre: sql`${sharedMines.extractedOre} - ${returned}` })
      .where(eq(sharedMines.id, mine.id));
  }

  const extracted = settlement.extracted - returned;
  const completed = { ...mine, lastTickAt: now, oreRemaining: mine.oreRemaining - extracted, extractedOre: mine.extractedOre + extracted, influenceOwnerId: influence.ownerUserId, influenceGameHours: influence.gameHours };
  const renewal = await renewDepletedMine(completed, crew, now);
  if (renewal) {
    const [fresh] = await getDb().select().from(sharedMines).where(eq(sharedMines.id, mine.id)).limit(1);
    return { ...(fresh ?? completed), totalWorkers: 0, renewal };
  }
  // Başka bir eşzamanlı istek damarı bu arada yenilediyse eski, boş sahayı
  // döndürmeyiz. Kullanıcı tek kare dahi tükenmiş ikonu görmeden yeni konumu
  // alır.
  if (completed.oreRemaining === 0) {
    const [fresh] = await getDb().select().from(sharedMines).where(eq(sharedMines.id, mine.id)).limit(1);
    if (fresh && fresh.vein !== completed.vein) return { ...fresh, totalWorkers: 0 };
  }
  return {
    ...completed,
    totalWorkers,
  };
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return response({ error: "Oturum gerekli." }, 401);
  const channelId = new URL(request.url).searchParams.get("channelId")?.trim();
  if (!channelId) return response({ error: "Channel gerekli." }, 400);
  const value = await context(user.id, channelId);
  if (!value) return response({ error: "Bu aktif channel'a katılmadınız." }, 403);
  const mine = await tickMine(value.mine, value.channel.speed, { now: Date.now() });
  const rows = await getDb().select({ userId: sharedMineWorkers.userId, workers: sharedMineWorkers.workers, deliveredOre: sharedMineWorkers.deliveredOre, gameState: gameSaves.gameState }).from(sharedMineWorkers).innerJoin(gameSaves, eq(gameSaves.userId, sharedMineWorkers.userId)).where(eq(sharedMineWorkers.mineId, mine.id));
  const participants = rows.flatMap(row => {
    const kingdom = projectPublicKingdom(row.userId, row.gameState, value.channel.name);
    return kingdom ? [{ id: row.userId, name: kingdom.name, workers: row.workers, deliveredOre: row.deliveredOre, self: row.userId === user.id }] : [];
  });
  // Tavan oyuncunun kendi kaydından okunur. Eskiden madendeki işçi listesinden
  // aranıyordu; madende işçisi olmayan oyuncu kendi tavanını göremiyordu.
  const [ownSave] = await getDb().select({ gameState: gameSaves.gameState }).from(gameSaves).where(eq(gameSaves.userId, user.id)).limit(1);
  const own = personalCap(ownSave?.gameState);
  return response({
    personalCap: own.cap,
    channelSlots: CHANNEL_SLOTS,
    // İşçi başına saatlik cevher: panel bunu SABİT KODLAMASIN, kural motorda.
    orePerWorkerHour: oreRate(1, value.channel.speed),
    mine: { id: mine.id, name: mine.name, vein: mine.vein, oreRemaining: mine.oreRemaining, extractedOre: mine.extractedOre, totalWorkers: mine.totalWorkers, position: { x: mine.positionX, z: mine.positionZ } },
    influence: { ownerId: mine.influenceOwnerId, ownerName: participants.find(participant => participant.id === mine.influenceOwnerId)?.name ?? null, gameHours: mine.influenceGameHours, windowHours: MINE_INFLUENCE_WINDOW_HOURS },
    renewal: mine.renewal ?? null,
    participants,
  });
}

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return response({ error: "Oturum gerekli." }, 401);
  const body = await request.json() as { channelId?: string; action?: "join" | "leave"; workers?: number };
  if (!body.channelId) return response({ error: "Channel gerekli." }, 400);
  const value = await context(user.id, body.channelId);
  if (!value) return response({ error: "Bu aktif channel'a katılmadınız." }, 403);
  // İşçilerini çeken oyuncuya küsuratı da ödenir: satır birazdan silinecek,
  // beklemeye bırakılan cevher onunla birlikte yok olurdu.
  const mine = await tickMine(value.mine, value.channel.speed, { now: Date.now(), forceUserId: body.action === "leave" ? user.id : null });
  if (body.action === "leave") {
    await getDb().delete(sharedMineWorkers).where(and(eq(sharedMineWorkers.mineId, mine.id), eq(sharedMineWorkers.userId, user.id)));
    await setMineWorkers(user.id, 0);
    return response({ working: false, workers: 0, renewal: mine.renewal ?? null });
  }
  if (body.action !== "join") return response({ error: "Geçersiz maden emri." }, 400);

  // Tavan istemciden değil, sunucudaki kayıttan okunan nüfustan türer.
  const [save] = await getDb().select({ gameState: gameSaves.gameState }).from(gameSaves).where(eq(gameSaves.userId, user.id)).limit(1);
  const { cap, population } = personalCap(save?.gameState);
  const requested = Math.max(1, Math.floor(Number(body.workers) || 5));
  if (requested > cap) {
    return response({ error: `Bu kadar insan ayıramazsınız: ${population} nüfusla en fazla ${cap} işçi gönderebilirsiniz.`, cap }, 409);
  }

  // Maden rakip bir kaynaktır: channel genelinde sınırlı yuva var, biri çok
  // alırsa diğerine az kalır. Kendi mevcut işçini hesaptan düş.
  const [taken] = await getDb().select({ total: sql<number>`coalesce(sum(${sharedMineWorkers.workers}), 0)` })
    .from(sharedMineWorkers).where(and(eq(sharedMineWorkers.mineId, mine.id), ne(sharedMineWorkers.userId, user.id)));
  const othersUse = Number(taken?.total ?? 0);
  const free = Math.max(0, CHANNEL_SLOTS - othersUse);
  if (requested > free) {
    return response({ error: `Madende yalnız ${free} boş yuva var; ${requested} işçi istediniz. Diğer krallıklar ${othersUse}/${CHANNEL_SLOTS} yuvayı tutuyor.`, free }, 409);
  }

  await getDb().insert(sharedMineWorkers).values({ mineId: mine.id, userId: user.id, workers: requested }).onConflictDoUpdate({ target: [sharedMineWorkers.mineId, sharedMineWorkers.userId], set: { workers: requested } });
  await setMineWorkers(user.id, requested);
  return response({ working: true, workers: requested, cap, channelFree: free - requested, channelSlots: CHANNEL_SLOTS, renewal: mine.renewal ?? null });
}
