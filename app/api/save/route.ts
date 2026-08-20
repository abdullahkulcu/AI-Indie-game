import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { channelMembers, channels, gameSaves } from "../../../db/schema";
import { currentUser } from "../../../server/account-auth";
import { RATE_LIMITS, consumeRateLimit, rateLimitResponse } from "../../../server/rate-limit";
import { parseTimestamp, parseStoredSave, validateGameSave } from "../../../server/save-validation";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

/** Oyuncunun gerçekten üye olduğu aktif channel; kayıttaki channel iddiası buna karşı doğrulanır. */
async function activeChannel(userId: string) {
  const [row] = await getDb().select({ name: channels.name, speed: channels.speed })
    .from(channelMembers).innerJoin(channels, eq(channels.id, channelMembers.channelId))
    .where(and(eq(channelMembers.userId, userId), eq(channelMembers.status, "active"), eq(channels.status, "active")))
    .limit(1);
  return row ?? null;
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers: noStore });
  const [save] = await getDb().select().from(gameSaves).where(eq(gameSaves.userId, user.id)).limit(1);
  if (!save) return Response.json({ game: null, user: { displayName: user.displayName } }, { headers: noStore });
  const game = parseStoredSave(save.gameState);
  // Bozuk veya artık şemaya uymayan kayıt istemciyi kilitlemesin: kayıt yokmuş gibi
  // davranıp kuruluş akışına düşürürüz.
  if (!game) {
    // Sürüm numarası bozuk kayıtta da verilir: `baseRevision` artık ZORUNLU
    // olduğu için, onsuz istemci bir daha hiç yazamaz ve kalıcı olarak kilitlenir.
    return Response.json({ game: null, corrupt: true, revision: save.revision, user: { displayName: user.displayName } }, { headers: noStore });
  }
  return Response.json({ game, revision: save.revision, updatedAt: save.updatedAt, user: { displayName: user.displayName } }, { headers: noStore });
}

/** Sürüm çakışması: istemcinin elindeki kopya eskidir, sunucudaki durum geri verilir. */
function conflict(gameState: string, revision: number) {
  return Response.json(
    { error: "Kayıt geride kaldı; sunucudaki güncel durum uygulandı.", conflict: true, game: parseStoredSave(gameState), revision },
    { status: 409, headers: noStore },
  );
}

export async function PUT(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers: noStore });
  const limit = await consumeRateLimit(RATE_LIMITS.save, `user:${user.id}`);
  if (!limit.allowed) return rateLimitResponse(limit, "Kayıt istekleri çok sıklaştı; birazdan tekrar denenecek.");
  const body = await request.json() as { game?: unknown; baseRevision?: number };

  const [existing] = await getDb().select().from(gameSaves).where(eq(gameSaves.userId, user.id)).limit(1);
  // İyimser kilit ZORUNLU: alanı göndermeyen istemci için sürüm denetimi hiç
  // çalışmıyordu, yani gece vardiyasının, haraç ödemesinin ve akının yazdığı
  // her şey tek bir `typeof` kontrolü atlanarak sessizce eziliyordu.
  // İlk kayıt (henüz satır yokken) muaftır: karşılaştıracak sürüm yoktur.
  if (existing && typeof body.baseRevision !== "number") {
    return Response.json({ error: "Kayıt sürümü bildirilmedi." }, { status: 400, headers: noStore });
  }
  const channel = await activeChannel(user.id);
  const result = validateGameSave(body.game, {
    previous: existing ? parseStoredSave(existing.gameState) : null,
    previousUpdatedAt: existing ? parseTimestamp(existing.updatedAt) : null,
    channelSpeed: channel?.speed ?? 1,
    channelName: channel?.name ?? null,
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status, headers: noStore });

  // İstemci hangi sürümün üstüne yazdığını bildirir. Sunucu o arada başka bir
  // şey yazdıysa (gece vardiyası, haraç ödemesi, akın) istemcinin eski kopyası
  // KABUL EDİLMEZ. Bu olmadan açık bir tarayıcı sekmesi, arka planda yapılan
  // her işi 5 saniye içinde sessizce siliyordu.
  if (existing && existing.revision !== body.baseRevision) return conflict(existing.gameState, existing.revision);

  const encoded = JSON.stringify(result.game);
  if (encoded.length > 200_000) return Response.json({ error: "Oyun kaydı çok büyük." }, { status: 413, headers: noStore });

  // Yazma TEK DEYİMDE koşulludur. Kontrol ile yazma arasında işlem yoktu:
  // koşulsuz `onConflictDoUpdate`, yukarıdaki sürüm kontrolünü geçen iki
  // eşzamanlı isteğin ikisini de kabul ediyordu (kontrol-sonra-yaz yarışı).
  if (existing) {
    const [written] = await getDb().update(gameSaves)
      .set({ gameState: encoded, revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(gameSaves.userId, user.id), eq(gameSaves.revision, body.baseRevision as number)))
      .returning({ revision: gameSaves.revision });
    if (!written) {
      // Yarışı kaybettik: satırın sürümü bu arada değişti.
      const [current] = await getDb().select().from(gameSaves).where(eq(gameSaves.userId, user.id)).limit(1);
      return current ? conflict(current.gameState, current.revision)
        : Response.json({ error: "Kayıt bulunamadı." }, { status: 409, headers: noStore });
    }
    return Response.json({ saved: true, revision: written.revision }, { headers: noStore });
  }

  // İlk kayıt: satır yoksa yazılır. Aynı anda ikinci bir istek satırı açtıysa
  // burada hiçbir satır dönmez ve yazma sessizce kaybolmak yerine 409 alır.
  const [created] = await getDb().insert(gameSaves).values({ userId: user.id, gameState: encoded })
    .onConflictDoNothing({ target: gameSaves.userId })
    .returning({ revision: gameSaves.revision });
  if (!created) {
    const [current] = await getDb().select().from(gameSaves).where(eq(gameSaves.userId, user.id)).limit(1);
    if (current) return conflict(current.gameState, current.revision);
  }
  return Response.json({ saved: true, revision: created?.revision ?? 1 }, { headers: noStore });
}

export async function DELETE(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers: noStore });
  await getDb().delete(gameSaves).where(eq(gameSaves.userId, user.id));
  return Response.json({ deleted: true }, { headers: noStore });
}
