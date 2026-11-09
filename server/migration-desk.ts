import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { channels, migrations } from "../db/schema";
import { migrationTravelMs } from "../engine/migration";

/**
 * BİR KAYDIN NÜFUS DEFTERİ İLERLEDİĞİNDE ayrılan halkı göç kuyruğuna alır.
 *
 * `before`/`after`, o kaydın `peopleLeft` alanının (tamamen sunucu-türevi,
 * bkz. server/save-validation.ts → SERVER_DERIVED yorumu, 1. sınıf) yazılmadan
 * önceki ve sonraki değerleridir. Yalnızca GERÇEKTEN yazılan (DB'ye işlenen)
 * bir artış kuyruğa girer — `tick()` çağrıldığı ama sonucu hiç kaydedilmediği
 * yerlerde (ör. `checkAgainstSimulation`'ın "hayalet" simülasyonu, gece
 * vardiyasının eyleme geçmeden önceki ön elemesi) bu fonksiyon HİÇ çağrılmaz;
 * aksi hâlde asla var olmayan göçmenler kuyruğa yazılırdı.
 *
 * Maliyet yok, hedef seçimi yok: bu, dış kesenin (`server/agitation-desk.ts`)
 * tersine, gönderenin İRADESİ değil krallığın DURUMUNUN doğal sonucudur.
 * Hedef `completesAt` anında, cron'da (bkz. app/api/cron/route.ts →
 * settleMigrations) o anki GÜNCEL adaylardan seçilir.
 */
export async function queueEmigrants(input: {
  channelId: string;
  sourceUserId: string;
  before: number | undefined;
  after: number | undefined;
  now: number;
}) {
  const count = Math.floor((input.after ?? 0) - (input.before ?? 0));
  if (count <= 0) return;
  const db = getDb();
  const [channel] = await db.select({ speed: channels.speed }).from(channels)
    .where(eq(channels.id, input.channelId)).limit(1);
  const speed = channel?.speed ?? 1;
  await db.insert(migrations).values({
    id: crypto.randomUUID(),
    channelId: input.channelId,
    sourceUserId: input.sourceUserId,
    count,
    sentAt: input.now,
    completesAt: input.now + migrationTravelMs(speed),
  });
}
