import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { agreements, channelMembers, gameSaves, mercenaryContracts, negotiationMessages, negotiations, wars } from "../../../db/schema";
import {
  DECLINABLE_STATUSES, LIMITS, MAX_MESSAGE_LENGTH, NEGOTIATION_TOPICS, SIGNABLE_STATUS,
  canBind, canDecline, canOpen, canProposeTerms, canSpeak, clampTerms, isNegotiationTopic, sideOf, validateTerms,
  type Side, type Terms,
} from "../../../engine/negotiation";
import { currentUser } from "../../../server/account-auth";
import { activeMembershipOf } from "../../../server/active-membership";
import { newId } from "../../../server/ids";
import { displayNameOf, loadTablesFor, toEngine } from "../../../server/negotiation-desk";
import { RATE_LIMITS, consumeRateLimit, rateLimitResponse } from "../../../server/rate-limit";
import { parseStoredSave } from "../../../server/save-validation";
import { recruitUnitExperience } from "../../../engine/units";
import { acceptWarTruce } from "../../../server/war-desk";
import { kingIsAwayOnCampaign } from "../../../server/war-regency";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });

// Konu listesi ve mesaj tavanı MOTORDAN gelir; burada elle yazılan bir kopya
// motor değiştiğinde sessizce geride kalıyordu.
const MAX_MESSAGE = MAX_MESSAGE_LENGTH;

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return json({ error: "Oturum gerekli." }, 401);
  // Okuma da sınırlıdır. Uç sınırsızdı; her çağrı masaları, bütün mesajları ve
  // her karşı taraf için ayrı bir kayıt okuyor. Sınır HESAP bazındadır ve
  // panelin 20 saniyelik yoklamasının üç katından geniş tutuldu.
  const limit = await consumeRateLimit(RATE_LIMITS.negotiateRead, `user:${user.id}`);
  if (!limit.allowed) return rateLimitResponse(limit, "Elçilik defteri çok sık okundu; birazdan tekrar denenecek.");
  const membership = await activeMembershipOf(user.id);
  if (!membership) return json({ error: "Aktif bir channel'a katılmadınız." }, 403);

  // Sıralama paylaşılan modülden gelir: arayüzün gördüğü sıra ile Generalin
  // araç çağrısındaki `table_ordinal` aynı masayı göstermek zorunda.
  const desk = await loadTablesFor(user.id, membership.channelId);

  const deals = await getDb().select().from(agreements)
    .where(and(eq(agreements.status, "active"), or(eq(agreements.payerId, user.id), eq(agreements.payeeId, user.id))));

  const tables = await Promise.all(desk.map(async ({ negotiation: row, side, messages }) => {
    const otherId = side === "initiator" ? row.targetId : row.initiatorId;
    return {
      id: row.id, topic: row.topic, status: row.status, turns: row.turns, side,
      counterpartId: otherId,
      counterpart: await displayNameOf(otherId, membership.channelName),
      proposed: row.proposed,
      proposedBy: row.proposedBy,
      // Kendi teklifini kendin onaylayamazsın.
      canAccept: row.status === SIGNABLE_STATUS && row.proposedBy !== null && row.proposedBy !== side,
      expiresAt: row.expiresAt,
      messages: messages.map(message => ({ mine: message.side === side, speaker: message.speaker, body: message.body, at: message.at })),
    };
  }));

  return json({
    acceptsNegotiation: membership.acceptsNegotiation,
    limits: { maxTurns: LIMITS.maxTurns, maxOpen: LIMITS.maxOpenPerKingdom, maxMessage: MAX_MESSAGE },
    // Panel konu listesini de motordan okusun; elle yazılan üçüncü bir kopya olmasın.
    topics: NEGOTIATION_TOPICS,
    tables,
    agreements: await Promise.all(deals.map(async deal => ({
      id: deal.id, topic: deal.topic, terms: JSON.parse(deal.terms) as Terms,
      iPay: deal.payerId === user.id,
      counterpartId: deal.payerId === user.id ? deal.payeeId : deal.payerId,
      counterpart: await displayNameOf(deal.payerId === user.id ? deal.payeeId : deal.payerId, membership.channelName),
      endsAt: deal.endsAt, paidCount: deal.paidCount, everyHours: deal.everyHours,
    }))),
  });
}

type Body = {
  action?: "open" | "reply" | "propose" | "accept" | "decline" | "set_open";
  targetId?: string; topic?: string; message?: string;
  negotiationId?: string; terms?: Terms; accepts?: boolean;
  /** Sözü Kral mı yazdı General mi? Generalin payı buradan sayılır. */
  speaker?: "king" | "general";
};

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return json({ error: "Oturum gerekli." }, 401);
  // Yazma emirleri hesap bazında sınırlıdır. canOpen/canSpeak masa kurallarını
  // tavanlıyor ama `set_open` hiçbirine takılmıyordu; sınırsız bir uç kalmasın.
  const limit = await consumeRateLimit(RATE_LIMITS.negotiate, `user:${user.id}`);
  if (!limit.allowed) return rateLimitResponse(limit, "Elçilik emirleri çok sıklaştı; bir süre sonra tekrar deneyin.");
  const body = await request.json() as Body;
  const db = getDb();
  const now = Date.now();

  const membership = await activeMembershipOf(user.id);
  if (!membership) return json({ error: "Aktif bir channel'a katılmadınız." }, 403);
  const kingAway = await kingIsAwayOnCampaign(user.id, membership.channelId);

  if (body.action === "set_open") {
    if (kingAway) return json({ error: "Kral cephedeyken elçilik düzeni değiştirilemez; bu karar dönüşe ertelendi." }, 409);
    await db.update(channelMembers).set({ acceptsNegotiation: Boolean(body.accepts) })
      .where(and(eq(channelMembers.userId, user.id), eq(channelMembers.channelId, membership.channelId)));
    return json({ acceptsNegotiation: Boolean(body.accepts) });
  }

  if (body.action === "open") {
    if (kingAway) return json({ error: "Kral cephedeyken yeni müzakere başlatılamaz; Naiplik yalnız mevcut savunmayı ve ekonomiyi yürütür." }, 409);
    const topic = body.topic;
    if (!isNegotiationTopic(topic)) return json({ error: "Geçersiz müzakere konusu." }, 400);
    const targetId = String(body.targetId ?? "");
    if (!targetId || targetId === user.id) return json({ error: "Geçerli bir karşı krallık seçilmeli." }, 400);

    const [target] = await db.select({ accepts: channelMembers.acceptsNegotiation }).from(channelMembers)
      .where(and(eq(channelMembers.userId, targetId), eq(channelMembers.channelId, membership.channelId), eq(channelMembers.status, "active"))).limit(1);
    if (!target) return json({ error: "Bu krallık aynı channel'da değil." }, 404);

    const [openCount] = await db.select({ count: sql<number>`count(*)` }).from(negotiations)
      .where(and(eq(negotiations.initiatorId, user.id), inArray(negotiations.status, ["open", "awaiting_king"])));
    const [incoming] = await db.select({ count: sql<number>`count(*)` }).from(negotiations)
      .where(and(eq(negotiations.targetId, targetId), gte(negotiations.openedAt, now - 86_400_000)));
    const [last] = await db.select({ openedAt: negotiations.openedAt }).from(negotiations)
      .where(and(
        or(and(eq(negotiations.initiatorId, user.id), eq(negotiations.targetId, targetId)),
           and(eq(negotiations.initiatorId, targetId), eq(negotiations.targetId, user.id))),
      )).orderBy(desc(negotiations.openedAt)).limit(1);

    const allowed = canOpen({
      openByInitiator: Number(openCount?.count ?? 0),
      incomingToTargetToday: Number(incoming?.count ?? 0),
      lastBetweenPairAt: last?.openedAt ?? null,
      targetAcceptsNegotiation: target.accepts,
      now,
    });
    if (!allowed.ok) return json({ error: allowed.reason }, 409);

    const id = newId("ng");
    await db.insert(negotiations).values({
      id, channelId: membership.channelId, initiatorId: user.id, targetId, topic,
      status: "open", turns: 1, openedAt: now, expiresAt: now + LIMITS.lifetimeMs, lastTurnAt: now,
    });
    await db.insert(negotiationMessages).values({
      id: newId("nm"), negotiationId: id, side: "initiator", speaker: "king",
      body: String(body.message ?? "").slice(0, MAX_MESSAGE) || "Konuşmak istiyoruz.", at: now,
    });
    return json({ opened: true, negotiationId: id });
  }

  // Buradan sonrası mevcut bir masayı gerektirir.
  const [row] = await db.select().from(negotiations).where(eq(negotiations.id, String(body.negotiationId ?? ""))).limit(1);
  if (!row) return json({ error: "Müzakere bulunamadı." }, 404);
  const side: Side | null = sideOf(row, user.id);
  if (!side) return json({ error: "Bu masada tarafınız yok." }, 403);
  const table = toEngine(row);

  // Savaşa bağlı ateşkes belgesi istisnadır: Kral cephedeyken de çatışmayı
  // durdurabilmelidir. Bunun dışındaki söz ve şartlar başkente dönene kadar
  // bekler; doğrudan Elçilik API'sine gelmek bu kuralı delmez.
  if (kingAway && !row.warId) {
    return json({ error: "Kral cephedeyken yeni diplomatik söz veya şart bağlanamaz; masa dönüşte yeniden açılacak." }, 409);
  }

  if (body.action === "reply") {
    const speak = canSpeak(table, side, now);
    if (!speak.ok) return json({ error: speak.reason }, 409);
  }
  if (body.action === "propose") {
    // Bu uç Kralın kendi oturumudur: bekleyen bir teklifin üstüne yazmak onun
    // kararıdır, teklifi görmüştür. Kral yokken aynı kural General'i durdurur.
    const allowed = canProposeTerms(table, side, true, now);
    if (!allowed.ok) return json({ error: allowed.reason }, 409);
  }

  if (body.action === "reply") {
    await db.insert(negotiationMessages).values({
      id: newId("nm"), negotiationId: row.id, side, speaker: body.speaker === "general" ? "general" : "king",
      body: String(body.message ?? "").slice(0, MAX_MESSAGE) || "…", at: now,
    });
    // Sayaç veritabanında artar. Eskiden okunmuş satırın turns değerine bir
    // eklenip yazılıyordu; iki eşzamanlı cevap aynı bayat değeri okuyup aynı
    // sayıyı yazıyor, bir tur sessizce kayboluyordu — masanın söz tavanı da o
    // kadar kaçıyordu.
    await db.update(negotiations).set({ turns: sql`${negotiations.turns} + 1`, lastTurnAt: now }).where(eq(negotiations.id, row.id));
    return json({ replied: true });
  }

  if (body.action === "propose") {
    const checked = validateTerms({ ...clampTerms(body.terms ?? { topic: row.topic }), topic: row.topic });
    if (!checked.ok) return json({ error: checked.reason }, 400);
    await db.update(negotiations)
      .set({ proposed: JSON.stringify(checked.terms), proposedBy: side, status: SIGNABLE_STATUS, turns: sql`${negotiations.turns} + 1`, lastTurnAt: now })
      .where(eq(negotiations.id, row.id));
    await db.insert(negotiationMessages).values({
      id: newId("nm"), negotiationId: row.id, side, speaker: body.speaker === "general" ? "general" : "king",
      body: String(body.message ?? "Şartımız ektedir.").slice(0, MAX_MESSAGE), at: now,
    });
    return json({ proposed: true, terms: checked.terms });
  }

  if (body.action === "decline") {
    // Kusur: hiçbir durum denetimi yoktu. İmzalanmış masa da "declined" oluyor,
    // anlaşma yürürlükte kalırken Kral anlaşmadan çıktığını sanıyordu.
    const allowed = canDecline(row.status);
    if (!allowed.ok) return json({ error: allowed.reason }, 409);
    const [closed] = await db.update(negotiations).set({ status: "declined", lastTurnAt: now })
      .where(and(eq(negotiations.id, row.id), inArray(negotiations.status, [...DECLINABLE_STATUSES])))
      .returning({ id: negotiations.id });
    if (!closed) return json({ error: "Bu masa bu arada kapandı." }, 409);
    // Ret, tarafları savaşmak zorunda bırakmaz; ancak aynı sefer için sonraki
    // saha sonucunda yeni bir şart sunabilme kilidini de açık tutar.
    if (row.warId) {
      await db.update(wars).set({ peaceOfferAt: null, revision: sql`${wars.revision} + 1` })
        .where(and(eq(wars.id, row.warId), eq(wars.peaceOfferAt, row.openedAt)));
    }
    return json({ declined: true });
  }

  if (body.action === "accept") {
    // İmzayı yalnızca Kral atar. Bu uç oturum gerektirdiği için buraya gelen
    // istek zaten Kralın kendisidir; General'in cron yolu buraya hiç gelmez.
    const bind = canBind(true);
    if (!bind.ok) return json({ error: bind.reason }, 403);
    if (row.status !== SIGNABLE_STATUS || !row.proposed || !table.proposed) return json({ error: "Onaylanacak bir şart yok." }, 409);
    if (row.proposedBy === side) return json({ error: "Kendi şartınızı kendiniz onaylayamazsınız." }, 409);

    const terms = table.proposed;
    const hours = terms.hours ?? 24;
    if (terms.topic === "mercenary" && terms.lessorSide !== "initiator" && terms.lessorSide !== "target") {
      return json({ error: "Kiralık birlik şartında kiralayan taraf geçersiz." }, 400);
    }
    const mercenaryLessorId = terms.topic === "mercenary"
      ? (terms.lessorSide === "initiator" ? row.initiatorId : row.targetId)
      : null;
    const mercenaryRenterId = mercenaryLessorId
      ? (mercenaryLessorId === row.initiatorId ? row.targetId : row.initiatorId)
      : null;
    if (terms.topic === "mercenary" && (!mercenaryLessorId || !mercenaryRenterId)) {
      return json({ error: "Kiralık birlik şartında kiralayan taraf belirlenemedi." }, 400);
    }
    // Yukarıdaki doğrulama sonrasında, sözleşme içindeki iki taraf da mutlaka
    // gerçek kullanıcı kimliğidir. Yerel sabitler Drizzle sorgularında null
    // kimliğin yanlışlıkla `IS NULL` sorgusuna dönüşmesini de engeller.
    const lessorId = mercenaryLessorId ?? "";
    const renterId = mercenaryRenterId ?? "";
    const payerId: string = terms.topic === "mercenary"
      ? mercenaryRenterId!
      : (terms.payerSide === "initiator" ? row.initiatorId : row.targetId);
    const payeeId: string = terms.topic === "mercenary"
      ? mercenaryLessorId!
      : (payerId === row.initiatorId ? row.targetId : row.initiatorId);
    const agreementId = newId("ag");

    // İmza yarışı burada kapanır. Durum geçişi KOŞULLU yazılır; yarışı yalnızca
    // bir istek kazanır ve anlaşma ANCAK o kazanan istekte yazılır. Eskiden
    // anlaşma koşulsuz yazılıyor, iki eşzamanlı imza masa başına iki aktif
    // anlaşma doğuruyor ve cron haracı İKİ KEZ tahsil ediyordu.
    const signed = await db.transaction(async trx => {
      const [claimed] = await trx.update(negotiations).set({ status: "agreed", lastTurnAt: now })
        .where(and(eq(negotiations.id, row.id), eq(negotiations.status, SIGNABLE_STATUS)))
        .returning({ id: negotiations.id });
      if (!claimed) return { ok: false as const, error: "Bu masa bu arada kapandı; imza atılamadı.", status: 409 };

      await trx.insert(agreements).values({
        id: agreementId, channelId: row.channelId, negotiationId: row.id, topic: row.topic,
        payerId, payeeId, terms: JSON.stringify(terms),
        startedAt: now, endsAt: now + hours * 3_600_000, everyHours: terms.everyHours ?? 6, paidCount: 0, status: "active",
      });

      if (row.warId) {
        const truce = await acceptWarTruce(trx, { warId: row.warId, now });
        if (!truce.ok) throw new Error(truce.error);
      }

      if (terms.topic === "mercenary") {
        const count = terms.mercenaryCount ?? 0;
        const fee = terms.mercenaryFee ?? 0;
        const [existingRows, lessorRow, renterRow] = await Promise.all([
          trx.select({ id: mercenaryContracts.id }).from(mercenaryContracts)
            .where(and(eq(mercenaryContracts.renterId, renterId), eq(mercenaryContracts.status, "active"))).limit(1),
          trx.select().from(gameSaves).where(eq(gameSaves.userId, lessorId)).limit(1),
          trx.select().from(gameSaves).where(eq(gameSaves.userId, renterId)).limit(1),
        ]);
        if (existingRows[0]) throw new Error("Bu krallıkta zaten yürürlükte bir kiralık birlik sözleşmesi var.");
        const lessor = lessorRow[0] ? parseStoredSave(lessorRow[0].gameState) : null;
        const renter = renterRow[0] ? parseStoredSave(renterRow[0].gameState) : null;
        if (!lessor || !renter || lessor.population - count < 20) {
          throw new Error("Kiralayan krallığın sözleşmeye ayıracak nüfusu yok.");
        }
        if (renter.resources.gold < fee) throw new Error("Kiracı krallığın peşin bedel için yeterli altını yok.");
        const nextLessor = {
          ...lessor,
          population: lessor.population - count,
          resources: { ...lessor.resources, gold: lessor.resources.gold + fee },
          notices: [{ kind: "KİRALIK BİRLİK", text: `${count} vatandaş ${hours} saatliğine kiraya verildi; ${fee} altın peşin tahsil edildi. Kayıplar size ait sayılacak.`, at: now }, ...lessor.notices].slice(0, 20),
        };
        const nextRenter = {
          ...renter,
          resources: { ...renter.resources, gold: renter.resources.gold - fee },
          units: { ...renter.units, mercenary: (renter.units.mercenary ?? 0) + count },
          unitExperience: recruitUnitExperience(renter.units, renter.unitExperience, { mercenary: count }),
          notices: [{ kind: "KİRALIK BİRLİK", text: `${count} Kiralık Birlik ${hours} saat için garnizona katıldı; ${fee} altın peşin ödendi. Kayıplar kiralayanın nüfusuna yazılır.`, at: now }, ...renter.notices].slice(0, 20),
        };
        const [lessorWritten] = await trx.update(gameSaves)
          .set({ gameState: JSON.stringify(nextLessor), revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
          .where(and(eq(gameSaves.userId, lessorId), eq(gameSaves.revision, lessorRow[0]!.revision)))
          .returning({ userId: gameSaves.userId });
        if (!lessorWritten) throw new Error("Kiralayan krallığın kaydı değişti; şartı yeniden sunun.");
        const [renterWritten] = await trx.update(gameSaves)
          .set({ gameState: JSON.stringify(nextRenter), revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
          .where(and(eq(gameSaves.userId, renterId), eq(gameSaves.revision, renterRow[0]!.revision)))
          .returning({ userId: gameSaves.userId });
        if (!renterWritten) throw new Error("Kiracı krallığın kaydı değişti; şartı yeniden sunun.");
        await trx.insert(mercenaryContracts).values({
          id: newId("mc"), channelId: row.channelId, agreementId, lessorId, renterId,
          count, fee, startedAt: now, endsAt: now + hours * 3_600_000, status: "active",
        });
      }

      return { ok: true as const };
    }).catch(error => ({ ok: false as const, error: error instanceof Error ? error.message : "Kiralık birlik sözleşmesi yazılamadı.", status: 409 }));
    if (!signed.ok) return json({ error: signed.error }, signed.status);
    return json({ agreed: true, terms });
  }

  return json({ error: "Geçersiz müzakere emri." }, 400);
}
