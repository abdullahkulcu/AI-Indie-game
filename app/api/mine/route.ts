import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { channelMembers, channels, gameSaves, sharedMines, sharedMineWorkers } from "../../../db/schema";
import { currentUser } from "../../../server/account-auth";
import { projectPublicKingdom } from "../../../server/world-projection";
import { parseStoredSave } from "../../../server/save-validation";

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
  await getDb().insert(sharedMines).values({ id, channelId: channel.id, lastTickAt: Date.now() }).onConflictDoNothing();
  const [mine] = await getDb().select().from(sharedMines).where(eq(sharedMines.id, id)).limit(1);
  return mine ? { channel, mine } : null;
}

async function tickMine(mine: typeof sharedMines.$inferSelect, speed: number) {
  const workers = await getDb().select({ total: sql<number>`coalesce(sum(${sharedMineWorkers.workers}), 0)` }).from(sharedMineWorkers).where(eq(sharedMineWorkers.mineId, mine.id));
  const totalWorkers = Number(workers[0]?.total ?? 0), elapsedHours = Math.min(6, Math.max(0, (Date.now() - mine.lastTickAt) / 3_600_000));
  const produced = Math.min(mine.oreRemaining, Math.floor(totalWorkers * 4 * speed * elapsedHours));
  if (produced > 0 || Date.now() - mine.lastTickAt > 30_000) await getDb().update(sharedMines).set({ oreRemaining: mine.oreRemaining - produced, extractedOre: mine.extractedOre + produced, lastTickAt: Date.now() }).where(eq(sharedMines.id, mine.id));
  return { ...mine, oreRemaining: mine.oreRemaining - produced, extractedOre: mine.extractedOre + produced, totalWorkers };
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return response({ error: "Oturum gerekli." }, 401);
  const channelId = new URL(request.url).searchParams.get("channelId")?.trim();
  if (!channelId) return response({ error: "Channel gerekli." }, 400);
  const value = await context(user.id, channelId);
  if (!value) return response({ error: "Bu aktif channel'a katılmadınız." }, 403);
  const mine = await tickMine(value.mine, value.channel.speed);
  const rows = await getDb().select({ userId: sharedMineWorkers.userId, workers: sharedMineWorkers.workers, gameState: gameSaves.gameState }).from(sharedMineWorkers).innerJoin(gameSaves, eq(gameSaves.userId, sharedMineWorkers.userId)).where(eq(sharedMineWorkers.mineId, mine.id));
  const participants = rows.flatMap(row => {
    const kingdom = projectPublicKingdom(row.userId, row.gameState, value.channel.name);
    return kingdom ? [{ id: row.userId, name: kingdom.name, workers: row.workers, self: row.userId === user.id }] : [];
  });
  // Tavan oyuncunun kendi kaydından okunur. Eskiden madendeki işçi listesinden
  // aranıyordu; madende işçisi olmayan oyuncu kendi tavanını göremiyordu.
  const [ownSave] = await getDb().select({ gameState: gameSaves.gameState }).from(gameSaves).where(eq(gameSaves.userId, user.id)).limit(1);
  const own = personalCap(ownSave?.gameState);
  return response({ personalCap: own.cap, channelSlots: CHANNEL_SLOTS, mine: { id: mine.id, name: mine.name, oreRemaining: mine.oreRemaining, extractedOre: mine.extractedOre, totalWorkers: mine.totalWorkers, position: { x: -52, z: 8 } }, participants });
}

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return response({ error: "Oturum gerekli." }, 401);
  const body = await request.json() as { channelId?: string; action?: "join" | "leave"; workers?: number };
  if (!body.channelId) return response({ error: "Channel gerekli." }, 400);
  const value = await context(user.id, body.channelId);
  if (!value) return response({ error: "Bu aktif channel'a katılmadınız." }, 403);
  await tickMine(value.mine, value.channel.speed);
  if (body.action === "leave") {
    await getDb().delete(sharedMineWorkers).where(and(eq(sharedMineWorkers.mineId, value.mine.id), eq(sharedMineWorkers.userId, user.id)));
    return response({ working: false, workers: 0 });
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
    .from(sharedMineWorkers).where(and(eq(sharedMineWorkers.mineId, value.mine.id), ne(sharedMineWorkers.userId, user.id)));
  const othersUse = Number(taken?.total ?? 0);
  const free = Math.max(0, CHANNEL_SLOTS - othersUse);
  if (requested > free) {
    return response({ error: `Madende yer kalmadı: ${CHANNEL_SLOTS} yuvanın ${othersUse}'i başka krallıklarca tutuluyor, size ${free} kaldı.`, free }, 409);
  }

  await getDb().insert(sharedMineWorkers).values({ mineId: value.mine.id, userId: user.id, workers: requested }).onConflictDoUpdate({ target: [sharedMineWorkers.mineId, sharedMineWorkers.userId], set: { workers: requested } });
  return response({ working: true, workers: requested, cap, channelFree: free - requested, channelSlots: CHANNEL_SLOTS });
}
