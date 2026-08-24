/**
 * HESAP VE SEZON YAŞAM DÖNGÜSÜNÜN KURALLARI.
 *
 * Bu dosya veritabanına DOKUNMAZ, yalnızca eşikleri ve cümleyi taşır; DB tarafı
 * `server/lifecycle-desk.ts` içindedir. Ayrım kod tabanının kendi ayrımı
 * (`night-shift.ts` kural, `*-desk.ts` veritabanı) ve pratik bir sebebi var:
 * `../db` `cloudflare:workers` içe aktardığı için testler o zincire bağlı bir
 * dosyadan değer okuyamıyor.
 */

/** Hesabın "uykuda" sayılması için gereken hareketsizlik (gün). */
export const DORMANT_DAYS = 30;

/**
 * Bir cron turunda en fazla kaç hesap silinir.
 *
 * Sınır iki işe yarar: tek turun iş yükü öngörülebilir kalır, VE bir hata
 * (yanlış eşik, bozuk saat) bütün tabloyu bir seferde götüremez. Kalanlar bir
 * sonraki turda silinir.
 */
export const PURGE_BATCH = 200;

/** Bu andan geriye `DORMANT_DAYS` gün. Bu tarihten önce hareket etmemiş hesap uykudadır. */
export const dormantCutoff = (now: number) => new Date(now - DORMANT_DAYS * 86_400_000);

/** Sezon kapandığında Kralın defterine düşen son satır. */
export const seasonClosedNotice = (channelName: string) =>
  `${channelName} sezonu kapandı. Krallığınız bu haliyle donduruldu; artık ilerlemiyor.`;
