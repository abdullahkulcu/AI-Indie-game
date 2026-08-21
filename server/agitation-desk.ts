import { and, count, desc, eq, gt, sql } from "drizzle-orm";
import { getDb } from "../db";
import { agitations, channelMembers, gameSaves } from "../db/schema";
import {
  AGITATION, type AgitationKind, agitationDayStart, agitationPairWindow,
  agitationSenderNotice, agitationTravelMs,
} from "../engine/agitation";
import type { Game } from "../engine/types";
import { parseStoredSave } from "./save-validation";

/**
 * DIŞ KESENİN GÖNDERİLMESİ.
 *
 * Omurga haraç/kese paketlerinin tamamında aynıdır:
 *   · Maliyet GÖNDERENİN kaydından TEK İŞLEMDE, sürüm korumalı düşer.
 *   · Etki HEDEFİN kaydına cron'da, ilgili anın geçmişine damgalanarak yazılır.
 *   · Hedefte hiçbir kaynak alanı yazılmaz.
 *
 * Buradaki tek işlem şu ikisini birlikte yapar: gönderenin altınını düşmek ve
 * görev satırını açmak. Biri geçip diğeri düşerse ya bedava kese gönderilmiş ya
 * da 600 altın hiçbir yere gitmeden yok olmuş olurdu.
 */

export type AgitateOutcome =
  | { ok: true; completesAt: number; cost: number }
  | { ok: false; status: 400 | 403 | 404 | 409 | 429; error: string };

const fail = (status: 400 | 403 | 404 | 409 | 429, error: string): AgitateOutcome => ({ ok: false, status, error });

export const AGITATION_LABELS: Record<AgitationKind, string> = {
  gold_commons: "halkın arasına",
  gold_garrison: "kışlaya",
};

/** Bir oyun-günü içinde kaç kese gönderildi/alındı? Tavanlar buradan okunur. */
async function purseCount(column: "source" | "target", userId: string, since: number) {
  const field = column === "source" ? agitations.sourceUserId : agitations.targetUserId;
  const [row] = await getDb().select({ total: count() }).from(agitations)
    .where(and(eq(field, userId), gt(agitations.sentAt, since)));
  return Number(row?.total ?? 0);
}

export async function sendAgitation(input: {
  channel: { id: string; name: string; speed: number };
  sourceUserId: string;
  targetUserId: string;
  kind: AgitationKind;
  now: number;
}): Promise<AgitateOutcome> {
  const db = getDb();
  const { channel, sourceUserId, targetUserId, kind, now } = input;
  if (sourceUserId === targetUserId) return fail(400, "Kendi krallığınıza kese gönderemezsiniz.");

  const [target] = await db.select({ userId: channelMembers.userId, accepts: channelMembers.acceptsAgitation })
    .from(channelMembers)
    .where(and(eq(channelMembers.userId, targetUserId), eq(channelMembers.channelId, channel.id), eq(channelMembers.status, "active")))
    .limit(1);
  if (!target) return fail(404, "Hedef bu channel'da değil.");
  if (!target.accepts) return fail(403, "Bu krallık dış keseye kapalı; kimse propaganda gönderemiyor.");

  const [sourceRow] = await db.select().from(gameSaves).where(eq(gameSaves.userId, sourceUserId)).limit(1);
  const [targetRow] = await db.select({ gameState: gameSaves.gameState }).from(gameSaves).where(eq(gameSaves.userId, targetUserId)).limit(1);
  const source = sourceRow ? parseStoredSave(sourceRow.gameState) : null;
  const targetSave = targetRow ? parseStoredSave(targetRow.gameState) : null;
  if (!source || !targetSave) return fail(409, "Krallık kaydı okunamadı; kese gönderilemedi.");

  // Kuruluş koruması: ne gönderir ne alır. "Kur, yak, boşalt" oyunu bu yüzden
  // ilk dört günden önce hiç işlemez.
  if (source.protectionEndsAt > now) return fail(403, "Kuruluş korumanız sürerken dışarıya kese gönderemezsiniz.");
  if (targetSave.protectionEndsAt > now) return fail(403, "Hedefin kuruluş koruması sürüyor; keseye kapalı.");

  // Çift arası bekleme İKİ katmanda tutulur ve ikisi ayrı işe yarar:
  //   · burada, tam süre ölçülür (son keseden bu yana 6 oyun saati geçti mi?);
  //   · veritabanındaki UNIQUE index'te, YARIŞ kapatılır (aynı pencerede iki
  //     eşzamanlı istek birlikte bu kontrolü geçse bile ikincisi reddedilir).
  // Yalnızca index'e güvenmek yetmezdi: sabit ızgara, pencere sınırının iki
  // yanına düşen iki keseye sıfır aralık tanıyabilir.
  const [lastPurse] = await db.select({ sentAt: agitations.sentAt }).from(agitations)
    .where(and(eq(agitations.sourceUserId, sourceUserId), eq(agitations.targetUserId, targetUserId)))
    .orderBy(desc(agitations.sentAt)).limit(1);
  const waitMs = AGITATION.pairWaitHours * 3_600_000 / Math.max(1, channel.speed);
  if (lastPurse && now - lastPurse.sentAt < waitMs) {
    const left = Math.ceil((waitMs - (now - lastPurse.sentAt)) / 60_000);
    return fail(429, `Aynı krallığa iki kese arasında ${AGITATION.pairWaitHours} oyun saati beklemek gerekir; ${left} dakika kaldı.`);
  }

  const dayStart = agitationDayStart(now, channel.speed);
  if (await purseCount("source", sourceUserId, dayStart) >= AGITATION.perSenderPerDay) {
    return fail(429, `Bir oyun-gününde en fazla ${AGITATION.perSenderPerDay} kese gönderilebilir.`);
  }
  if (await purseCount("target", targetUserId, dayStart) >= AGITATION.perTargetPerDay) {
    return fail(429, `Bu krallık bugün taşıyabileceği kadar kese aldı (${AGITATION.perTargetPerDay}); hat bir süre kapalı.`);
  }
  if (source.resources.gold < AGITATION.cost) {
    return fail(409, `Kese ${AGITATION.cost} altın; hazinede ${Math.floor(source.resources.gold)} var.`);
  }

  const completesAt = now + agitationTravelMs(channel.speed);
  const next: Game = {
    ...(source as Game),
    resources: { ...source.resources, gold: source.resources.gold - AGITATION.cost },
    notices: [{
      kind: "KESE",
      text: `${AGITATION.cost} altınlık bir kese komşu krallığın ${AGITATION_LABELS[kind]} yola çıktı.`,
      at: now,
    }, ...source.notices].slice(0, 20),
  };

  // Tek işlem: altın düşer ve görev satırı açılır. Çift bekleme kuralı UNIQUE
  // index'te durduğu için yarışan ikinci istek burada, veritabanında reddedilir.
  const sent = await db.transaction(async trx => {
    const debited = await trx.update(gameSaves)
      .set({ gameState: JSON.stringify(next), revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(gameSaves.userId, sourceUserId), eq(gameSaves.revision, sourceRow!.revision)))
      .returning({ userId: gameSaves.userId });
    if (!debited.length) return "stale" as const;
    const opened = await trx.insert(agitations).values({
      id: crypto.randomUUID(), channelId: channel.id,
      sourceUserId, targetUserId, kind, cost: AGITATION.cost, costResource: "gold",
      sentAt: now, completesAt, pairWindow: agitationPairWindow(now, channel.speed),
    }).onConflictDoNothing().returning({ id: agitations.id });
    if (!opened.length) { trx.rollback(); return "waiting" as const; }
    return "ok" as const;
  }).catch(() => "waiting" as const);

  if (sent === "stale") return fail(409, "Krallık kaydı bu arada değişti; keseyi tekrar gönderin.");
  if (sent !== "ok") {
    return fail(429, `Aynı krallığa iki kese arasında ${AGITATION.pairWaitHours} oyun saati beklemek gerekir.`);
  }
  return { ok: true, completesAt, cost: AGITATION.cost };
}

/** Gönderene yazılacak sonuç satırı; cron ifşayı öğrendikten sonra kullanır. */
export const senderNotice = agitationSenderNotice;
