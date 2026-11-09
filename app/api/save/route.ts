import { and, eq, inArray, or, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { agreements, gameSaves, negotiations } from "../../../db/schema";
import { DECLINABLE_STATUSES } from "../../../engine/negotiation";
import { currentUser } from "../../../server/account-auth";
import { activeMembershipOf } from "../../../server/active-membership";
import { noteToKing } from "../../../server/king-notice";
import { RATE_LIMITS, consumeRateLimit, rateLimitResponse } from "../../../server/rate-limit";
import { parseTimestamp, parseStoredSave, validateGameSave } from "../../../server/save-validation";
import { queueEmigrants } from "../../../server/migration-desk";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

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
  // Üyelik seçimi TEK yerden gelir. Burada ayrı bir SIRASIZ `limit(1)` duruyordu:
  // iki aktif üyeliği olan Kralın hangi channel'ına yazıldığı rastgeleydi ve
  // müzakere yolu (server/active-membership) başka bir channel seçebiliyordu —
  // kayıt bir sezona, masa başkasına giderdi.
  const channel = await activeMembershipOf(user.id);
  const previous = existing ? parseStoredSave(existing.gameState) : null;
  const result = validateGameSave(body.game, {
    previous,
    previousUpdatedAt: existing ? parseTimestamp(existing.updatedAt) : null,
    channelSpeed: channel?.channelSpeed ?? 1,
    channelName: channel?.channelName ?? null,
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
    // Göç kuyruğu: bu yazma GERÇEKTEN DB'ye işlendiği için, `peopleLeft`
    // defterinin bu adımda ne kadar ilerlediği artık kalıcıdır. Kuyruğa alma
    // burada, `tick()`'in kendisinde DEĞİL: motor saf kalmalı (Math.random/
    // Date.now/crypto yasak) ve `tick()` hem istemcide hem sunucunun "hayalet"
    // doğrulama simülasyonunda (`checkAgainstSimulation`) çağrılıyor — orada
    // kuyruğa alınsaydı hiç yazılmayan bir göç bile kayda geçerdi.
    // Hata bu isteği DÜŞÜRMEZ: göçmen kuyruğu bir sonraki kayıtta yine denenir.
    if (channel) {
      try {
        await queueEmigrants({
          channelId: channel.channelId, sourceUserId: user.id,
          before: previous?.peopleLeft, after: result.game.peopleLeft, now: Date.now(),
        });
      } catch { /* göç kuyruğu düşerse bile Kralın kaydı kaybolmasın */ }
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

/**
 * Krallığını sıfırlayan Kralın DIŞ TAAHHÜTLERİ de kapanır.
 *
 * Kusur: yalnızca kayıt siliniyordu. `negotiations` ve `agreements` yerinde
 * kalıyor, cron `parseStoredSave` null dönünce sessizce atlıyordu — karşı taraf
 * ne ödeme alıyor, ne ihlal görüyordu; anlaşma `endsAt`'e kadar hayalet olarak
 * duruyor, masa da cevaplanmayı bekliyordu.
 *
 * Sıra önemli: önce masalar ve anlaşmalar kapanır, sonra kayıt silinir. Tersi
 * olsaydı, arada düşen bir istek kaydı silinmiş ama taahhütleri açık bir Kral
 * bırakırdı — yani düzeltmeye çalıştığımız durumun aynısı.
 */
async function closeCommitments(userId: string, now: number) {
  const db = getDb();
  const mine = or(eq(negotiations.initiatorId, userId), eq(negotiations.targetId, userId));

  // Açık masalar kapanır. Karşı tarafa haber verilebilmesi için önce kimlerle
  // konuşulduğu okunur.
  const openTables = await db.select().from(negotiations)
    .where(and(mine, inArray(negotiations.status, [...DECLINABLE_STATUSES])));
  if (openTables.length) {
    await db.update(negotiations).set({ status: "declined", lastTurnAt: now })
      .where(and(mine, inArray(negotiations.status, [...DECLINABLE_STATUSES])));
  }

  // Yürürlükteki anlaşmalar bozulur. Sıfırlayan taraf sözünden dönmüştür;
  // itibar cezası kaydı silindiği için yazılamaz, ama karşı taraf durumu görür.
  const deals = await db.select().from(agreements)
    .where(and(eq(agreements.status, "active"), or(eq(agreements.payerId, userId), eq(agreements.payeeId, userId))));
  if (deals.length) {
    await db.update(agreements).set({ status: "broken" })
      .where(and(eq(agreements.status, "active"), or(eq(agreements.payerId, userId), eq(agreements.payeeId, userId))));
  }

  // Karşı taraflara TEK bildirim: aynı Kralla hem masası hem anlaşması olan
  // oyuncunun defterini iki satırla doldurmayalım.
  const affected = new Map<string, { tables: number; deals: number }>();
  const bump = (id: string, key: "tables" | "deals") => {
    if (id === userId) return;
    const entry = affected.get(id) ?? { tables: 0, deals: 0 };
    entry[key] += 1; affected.set(id, entry);
  };
  for (const table of openTables) bump(table.initiatorId === userId ? table.targetId : table.initiatorId, "tables");
  for (const deal of deals) bump(deal.payerId === userId ? deal.payeeId : deal.payerId, "deals");

  for (const [otherId, counts] of affected) {
    const parts: string[] = [];
    if (counts.deals) parts.push(`${counts.deals} anlaşma bozuldu`);
    if (counts.tables) parts.push(`${counts.tables} masa kapandı`);
    await noteToKing(otherId, "ELÇİLİK", `Karşı krallık ortadan kalktı; ${parts.join(", ")}. Bundan sonra o taraftan ödeme beklemeyin.`, now);
  }
  return { tables: openTables.length, deals: deals.length };
}

export async function DELETE(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Oturum gerekli." }, { status: 401, headers: noStore });
  const closed = await closeCommitments(user.id, Date.now());
  await getDb().delete(gameSaves).where(eq(gameSaves.userId, user.id));
  return Response.json({ deleted: true, closed }, { headers: noStore });
}
