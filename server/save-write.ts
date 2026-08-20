import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { gameSaves } from "../db/schema";

/**
 * Kaydı YALNIZCA okuduğumuz sürüm hâlâ geçerliyse yazar.
 *
 * Sunucu tarafındaki her yazma (gece vardiyası, haraç ödemesi, ortak madenin
 * cevher teslimi) bu kapıdan geçer. Koşulsuz yazıldığında Kralın tarayıcısı
 * 5 saniyede bir kaydettiği için aradaki inşaat, kuyruk ya da yeni bina
 * SESSİZCE siliniyordu. Yazma başarısızsa çağıran taze durumla tekrar dener —
 * ya da yapacağı işi bir sonraki tura bırakır.
 *
 * Tek kopya olması şart: aynı koşullu UPDATE iki yerde ayrı ayrı yazıldığında
 * biri sürüm artırmayı unutur ve kayıp yazma geri gelir.
 */
export async function writeSaveIfUnchanged(userId: string, expectedRevision: number, game: unknown) {
  const rows = await getDb().update(gameSaves)
    .set({ gameState: JSON.stringify(game), revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(gameSaves.userId, userId), eq(gameSaves.revision, expectedRevision)))
    .returning({ revision: gameSaves.revision });
  return rows.length > 0;
}
