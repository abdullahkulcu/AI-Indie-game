import { and, eq, isNull, or } from "drizzle-orm";
import { getDb } from "../db";
import { populaceCredentials } from "../db/schema";
import { activeMembershipOf } from "./active-membership";
import { type PopulaceCredentialRow, type ResolvedPopulaceCredential, resolvePopulaceCredential } from "./populace-ai-credentials";

/**
 * HALK-AI KİMLİK BİLGİSİNİN VERİTABANI TARAFI.
 *
 * `server/migration-desk.ts` ve `server/agitation-desk.ts` ile aynı iş bölümü:
 * kural saf dosyada (`server/populace-ai-credentials.ts`), sorgu burada. Kuralı
 * burada tekrar yazmak yasak — öncelik sırası orada BİR kere yaşıyor.
 *
 * Fikir 2/7/8/9/15/16 halkın sesini üretmek istediğinde çağıracağı TEK
 * fonksiyon `populaceCredentialFor`dur.
 */

/**
 * Krallığın Halk-AI kimlik bilgisini çözer; yoksa `null`.
 *
 * Channel, krallığın AKTİF üyeliğinden okunur (`activeMembershipOf` — üyelik
 * kuralının tek kaynağı). Tek sorgu hem channel varsayılanını hem bu krallığın
 * override'ını getirir; hangisinin kazandığına saf kural karar verir.
 *
 * `masterKey` dışarıdan verilir (uçta `env.BYOK_MASTER_KEY`): sırrın nereden
 * geldiği çağıranın gözünde kalsın, bu modül onu saklamasın.
 */
export async function populaceCredentialFor(userId: string, masterKey: string): Promise<ResolvedPopulaceCredential | null> {
  const membership = await activeMembershipOf(userId);
  if (!membership) return null;
  const rows: PopulaceCredentialRow[] = await getDb().select({
    id: populaceCredentials.id,
    channelId: populaceCredentials.channelId,
    userId: populaceCredentials.userId,
    persona: populaceCredentials.persona,
    provider: populaceCredentials.provider,
    model: populaceCredentials.model,
    encryptedKey: populaceCredentials.encryptedKey,
    iv: populaceCredentials.iv,
    keyVersion: populaceCredentials.keyVersion,
  })
    .from(populaceCredentials)
    .where(and(
      eq(populaceCredentials.channelId, membership.channelId),
      or(isNull(populaceCredentials.userId), eq(populaceCredentials.userId, userId)),
    ));
  return resolvePopulaceCredential(rows, membership.channelId, userId, masterKey);
}
