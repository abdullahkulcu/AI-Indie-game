import { and, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { getDb } from "../db";
import { channelMembers, channels, gameSaves, users } from "../db/schema";
import { PURGE_BATCH, dormantCutoff, seasonClosedNotice } from "./lifecycle";
import { parseStoredSave } from "./save-validation";
import { writeSaveIfUnchanged } from "./save-write";

/**
 * HESAP VE SEZON YAŞAM DÖNGÜSÜ — VERİTABANI TARAFI.
 *
 * İki iş de "artık yaşamayan şeyi kapat" ailesinden, ama biri GERİ DÖNÜŞSÜZ
 * (hesap silme) öteki DEĞİL (sezon dondurma). Bu yüzden ikisi ayrı fonksiyon ve
 * silme tarafı çok daha fazla emniyet taşıyor.
 *
 * Cron sırası ÖNEMLİ: önce sezonlar kapanır, sonra hesaplar silinir. Böylece
 * uykuda kalmış oyuncunun sezonu çoğu zaman ZATEN kapanmış olur ve silinmesi
 * canlı bir sezonun haritasından bir krallık koparmaz.
 *
 * Eşikler ve cümle `server/lifecycle.ts` içinde; burada tekrar yazılmaz.
 */

/**
 * SÜRESİ DOLAN SEZONLARI KAPATIR.
 *
 * `channels.endsAt` kuruluşta yazılıyordu ama HİÇBİR YER OKUMUYORDU: süresi
 * bitmiş bir sezon sonsuza kadar açık kalıyor, cron onu ticklemeye devam ediyor
 * ve oyuncular bitmiş bir sezonda oynamayı sürdürüyordu.
 *
 * Kapanış iki adımdır ve TEK İŞLEMDE olur: yarım kapanmış bir sezon (channel
 * pasif ama üyelikler aktif, ya da tersi) iki uçta iki farklı cevap üretirdi.
 *
 * Kapanışın kendisi başka hiçbir yeri değiştirmek gerektirmiyor, çünkü cron'un
 * bütün turları ve `activeMembershipOf` ZATEN `channels.status = 'active'`
 * koşuluyla okuyor: sezon pasife düştüğü an gece vardiyası, haraç, kese, göç ve
 * müzakere o sezon için kendiliğinden duruyor.
 *
 * Kayıt SİLİNMEZ. Krallık durduğu yerde kalır; oyuncu onu görmeye devam eder,
 * yalnızca ilerletemez (bkz. `app/api/save/route.ts` → donmuş kayıt).
 */
export async function closeEndedChannels(now: number) {
  const db = getDb();
  const closed = await db.transaction(async trx => {
    const rows = await trx.update(channels)
      .set({ status: "inactive" })
      .where(and(
        eq(channels.status, "active"),
        sql`${channels.endsAt} is not null`,
        lte(channels.endsAt, new Date(now)),
      ))
      .returning({ id: channels.id, name: channels.name });
    if (!rows.length) return [];
    await trx.update(channelMembers)
      .set({ status: "inactive" })
      .where(and(
        inArray(channelMembers.channelId, rows.map(row => row.id)),
        eq(channelMembers.status, "active"),
      ));
    return rows;
  });
  if (!closed.length) return { channels: 0, frozen: 0, noticed: 0 };

  // Kimlerin krallığı donduysa defterine son satır düşer. Sezon KAPANDIKTAN
  // sonra yazılır: satır yazılamasa bile sezon kapalı kalır, tersi olsaydı
  // yazma hatası sezonu açık bırakırdı.
  const members = await db.select({ userId: channelMembers.userId, channelId: channelMembers.channelId })
    .from(channelMembers)
    .where(inArray(channelMembers.channelId, closed.map(row => row.id)));
  const nameOf = new Map(closed.map(row => [row.id, row.name]));

  let noticed = 0;
  for (const member of members) {
    const [row] = await db.select({ gameState: gameSaves.gameState, revision: gameSaves.revision })
      .from(gameSaves).where(eq(gameSaves.userId, member.userId)).limit(1);
    const save = row ? parseStoredSave(row.gameState) : null;
    if (!save) continue;
    const text = seasonClosedNotice(nameOf.get(member.channelId) ?? save.channel);
    // Aynı satır iki kez düşmesin: kapanış bir kere olur ama cron'un turu
    // yeniden denenirse (kısmi hata) fonksiyon baştan çalışabilir.
    if (save.notices.some(notice => notice.text === text)) continue;
    const written = await writeSaveIfUnchanged(member.userId, row!.revision, {
      ...save,
      notices: [{ kind: "SEZON", text, at: now }, ...save.notices].slice(0, 20),
    });
    if (written) noticed += 1;
  }
  return { channels: closed.length, frozen: members.length, noticed };
}

/**
 * BİR AYDIR HAREKET ETMEYEN HESAPLARI SİLER. GERİ DÖNÜŞÜ YOKTUR.
 *
 * HAREKETSİZLİK `lastLoginAt` DEĞİLDİR — ve bu ayrım tek başına bu fonksiyonun
 * en önemli kararı. Oturum çerezi 30 gün yaşıyor
 * (`server/account-auth.ts`), yani her gün oynayan bir oyuncu bir daha HİÇ
 * giriş yapmadan bir ay geçirebilir: `lastLoginAt`'e bakan bir silme, aktif
 * oynayan Kralın hesabını silerdi. Bu yüzden ölçüt "son görülme":
 *
 *   en son ( giriş ya da kayıt oluşturma , kaydın en son yazılması )
 *
 * `gameSaves.updatedAt` her kayıt yazmasında (oynarken 5 saniyede bir)
 * ilerlediği için gerçek bir "son görülme" damgasıdır ve bedava gelir; yeni bir
 * kolon ya da fazladan yazma gerekmez. Kaydı hiç olmayan hesapta ölçüt girişe,
 * girişi de yoksa kuruluşa düşer.
 *
 * EMNİYETLER:
 *  - `admin` ASLA silinmez.
 *  - Bir channel ya da Halk-AI kimliği OLUŞTURMUŞ hesap silinmez: o iki
 *    yabancı anahtar `NO ACTION` (kasıtlı, sezon tarihini koruyor) ve silme
 *    denemesi hata verip bütün turu düşürürdü. Sayısı rapora yazılır ki
 *    sessizce atlanmış olmasın.
 *  - Tur başına en fazla `PURGE_BATCH` hesap.
 *  - `game_saves`in users'a YABANCI ANAHTARI YOK (şemada bilinçli olarak
 *    `primaryKey`, referans değil), yani cascade onu TEMİZLEMEZ. Aynı işlemde
 *    elle silinir; yoksa her silinen hesap arkasında sonsuza kadar yaşayan bir
 *    krallık kaydı bırakırdı.
 *
 * Geri kalan her şey cascade ile gider: oturumlar, üyelikler, BYOK kimliği,
 * müzakereler, anlaşmalar, keseler, göç kuyruğu, gece emri, defter.
 */
export async function purgeDormantAccounts(now: number) {
  const db = getDb();
  const cutoff = dormantCutoff(now);

  const dormant = await db.select({ id: users.id })
    .from(users)
    .leftJoin(gameSaves, eq(gameSaves.userId, users.id))
    .where(and(
      ne(users.role, "admin"),
      sql`greatest(
            coalesce(${users.lastLoginAt}, ${users.createdAt}),
            coalesce(${gameSaves.updatedAt}, ${users.createdAt})
          ) <= ${cutoff}`,
      sql`not exists (select 1 from channels c where c.created_by = ${users.id})`,
      sql`not exists (select 1 from populace_credentials pc where pc.created_by = ${users.id})`,
    ))
    .limit(PURGE_BATCH);

  if (!dormant.length) return { deleted: 0, protected: 0 };

  // Korunanların sayısı: aynı eşiği geçmiş ama channel/kimlik sahibi olduğu için
  // silinmeyen hesaplar. Yalnızca SAYI raporlanır, e-posta ya da ad yazılmaz.
  const [guard] = await db.select({ count: sql<number>`count(*)::int` })
    .from(users)
    .leftJoin(gameSaves, eq(gameSaves.userId, users.id))
    .where(and(
      ne(users.role, "admin"),
      sql`greatest(
            coalesce(${users.lastLoginAt}, ${users.createdAt}),
            coalesce(${gameSaves.updatedAt}, ${users.createdAt})
          ) <= ${cutoff}`,
      sql`(exists (select 1 from channels c where c.created_by = ${users.id})
           or exists (select 1 from populace_credentials pc where pc.created_by = ${users.id}))`,
    ));

  const ids = dormant.map(row => row.id);
  await db.transaction(async trx => {
    // ÖNCE kayıt: yabancı anahtarı olmadığı için users silindikten sonra
    // sahipsiz kalır ve bir daha bulunamaz.
    await trx.delete(gameSaves).where(inArray(gameSaves.userId, ids));
    await trx.delete(users).where(inArray(users.id, ids));
  });
  return { deleted: ids.length, protected: guard?.count ?? 0 };
}
