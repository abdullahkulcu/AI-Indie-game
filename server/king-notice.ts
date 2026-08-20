import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { gameSaves } from "../db/schema";
import { parseStoredSave } from "./save-validation";

/**
 * Kralın defterine bir satır yazar — TEK yer.
 *
 * Sunucunun oyuncuya "bunu ben yaptım" diyebildiği tek kanal budur: kayıt
 * istemcide hesaplanıyor, dolayısıyla arka planda olan her şey (haraç, gece
 * vardiyası, masanın kapanması) buraya düşmezse oyuncu hiçbir zaman öğrenmez.
 *
 * Kayıt TICK'LENMEZ: `lastTickAt` Kralın kendi istemcisinin izidir ve "masada
 * mı?" sorusunun ölçütüdür (bkz. engine/negotiation.ts → isKingPresent). Burada
 * ilerletilseydi sunucu kendi notuyla Kralı masada göstermiş olurdu.
 *
 * Kayıt yoksa ya da okunamıyorsa sessizce döner: yazacak defter yoktur.
 */
export async function noteToKing(userId: string, kind: string, text: string, now: number) {
  const db = getDb();
  const [row] = await db.select().from(gameSaves).where(eq(gameSaves.userId, userId)).limit(1);
  const game = row ? parseStoredSave(row.gameState) : null;
  if (!game) return false;
  const next = { ...game, notices: [{ kind, text: text.slice(0, 240), at: now }, ...game.notices].slice(0, 20) };
  await db.update(gameSaves)
    .set({ gameState: JSON.stringify(next), revision: sql`${gameSaves.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(gameSaves.userId, userId));
  return true;
}
