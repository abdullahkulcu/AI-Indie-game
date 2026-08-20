import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { channelMembers, channels } from "../db/schema";

/**
 * Kralın aktif channel üyeliği — TEK kural, tek yer.
 *
 * Kusur: `/api/negotiate` üyeliği sırasız bir `limit(1)` ile seçiyordu. İki
 * aktif üyeliği olan bir Kralın hangi channel'ın masasına oturduğu rastgeleydi;
 * kayıt bir channel'a, müzakere başkasına gidebiliyordu. Üstelik channel'ın
 * kendi durumu hiç sorulmuyordu: kapatılmış bir sezonun üyeliği seçilebiliyordu.
 *
 * Aday kümesi `app/api/save/route.ts` içindeki `activeChannel` ile AYNI üç
 * koşuldan doğar (üyelik aktif + channel aktif + o kullanıcı); tek fark burada
 * sıranın da sabitlenmiş olmasıdır: en son katılınan üyelik kazanır, eşitlikte
 * channel kimliği belirler. Böylece aynı Kral iki ayrı istekte iki ayrı cevap
 * almaz.
 */
export async function activeMembershipOf(userId: string) {
  const [row] = await getDb().select({
    channelId: channelMembers.channelId,
    channelName: channels.name,
    acceptsNegotiation: channelMembers.acceptsNegotiation,
  })
    .from(channelMembers)
    .innerJoin(channels, eq(channels.id, channelMembers.channelId))
    .where(and(
      eq(channelMembers.userId, userId),
      eq(channelMembers.status, "active"),
      eq(channels.status, "active"),
    ))
    .orderBy(desc(channelMembers.joinedAt), asc(channelMembers.channelId))
    .limit(1);
  return row ?? null;
}
