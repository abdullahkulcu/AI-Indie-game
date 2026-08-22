import { rand01 } from "./raids";

/**
 * FAZ 6 — GÖÇÜN ÇOK KRALLIĞA DAĞILMASI.
 *
 * ORİJİNAL TASARIM BELGESİ KAYIP: bu dosya, artık erişilemeyen bir Claude Code
 * artifact'ının yerine kod tabanından çıkarılan bir REKONSTRÜKSİYONDUR (bkz.
 * DEVIRTESLIM-2026-08-21.md, "Faz 6" satırı — "hiç başlanmadı" diyor, plan
 * metnini vermiyor). Aşağıdaki yorum bu rekonstrüksiyonun gerekçesini taşır.
 *
 * KANIT: `engine/tick.ts` içinde nüfus bir krallıktan ayrılınca (`peopleLeft`
 * artınca) yalnızca bir "GÖÇ" bildirimi yazılıyor, sayı HİÇBİR YERE gitmiyor —
 * yarım bırakılmış bir uç. Aynı anda channel'da OYNANABİLİR başka krallıklar
 * (bkz. `engine/world-map.ts` → `layoutChannel`) var; "göçün çok krallığa
 * dağılması" başlığı en doğal biçimde bu ayrılan nüfusun channel'daki diğer
 * krallıklara ULAŞMASI olarak okunur.
 *
 * DESEN SEÇİMİ: bu, tam olarak DIŞ KESE'nin (`engine/agitation.ts`) ve ortak
 * madenin (`engine/mine.ts`) zaten kurduğu "channel-genelinde gecikmeli etki"
 * desenidir: bir krallıktaki bir olay, cron'da BAŞKA bir krallığın kaydına
 * sürüm korumalı olarak yazılır. Farkı: kese TEK bir gönderenden TEK bir
 * hedefe gider; göç TEK bir kaynaktan channel'daki ADAYLAR arasından TEK bir
 * hedefe (kapasitesi izin veren, en çekici olana) yönelir — mal kesesindeki
 * "hedef seçilmiş" modelin, hedefin SABİT değil ADAYLAR arasından seçildiği
 * hâli.
 *
 * NEDEN ZAR YOK (raids.ts'in tohumlu tekniği kullanılsa da): akınlar doğanın
 * kendiliğinden gelen bir olayıdır ve "olur mu olmaz mı" sorusuna cevap arar;
 * göç ise HANGİ krallığın göçmeni ÇEKTİĞİ sorusuna cevap arayan bir EKONOMİK
 * tercihtir (boş konut + rıza). Bu yüzden `pickMigrationTarget` klasik "zar
 * atıp eşiği geçti mi" modelini değil, AĞIRLIKLI TEK SEÇİM modelini kullanır:
 * ağırlıkların TOPLAMI üstünden TEK bir tohumlu sayı çekilir (rulet çarkı).
 * Yine de saf ve tohumludur — `rand01` `engine/raids.ts` ile AYNI karma
 * fonksiyonunu kullanır, ikinci bir rastgelelik kaynağı açılmaz (tek doğru
 * kaynak). Girdi aynıysa çıktı hep aynıdır; save-scum işe yaramaz.
 *
 * KAPASİTE TAVANI: hedefin boş konutu (`capacity - population`) sıfırın
 * altındaysa aday listesinden düşer — "Kapasiteyi aşan bir krallığa göçmen
 * gitmemeli" kısıtı burada uygulanır (bkz. engine/tick.ts → capacityFor).
 *
 * TABAN ÇEKİCİLİK: rızası dibe vurmuş bir krallık göçmen ÇEKMEZ demek yanlış
 * bir izlenim verirdi — göçmenler zaten BİR YERDEN kaçıyor, mutlak olarak
 * mükemmel bir yer değil, ELDEKİLERİN EN AZ KÖTÜSÜNÜ arıyorlar. Bu yüzden
 * çekicilik sıfıra inmez, `ATTRACTIVENESS_FLOOR`'un altına düşmez; rıza yalnızca
 * ince ayardır, veto değildir.
 */

export type MigrationCandidate = {
  userId: string;
  population: number;
  capacity: number;
  /** Hedefin rızası; çekiciliğin ince ayarını yapar, vetosu yoktur. */
  popularity: number;
};

export type MigrationTarget = { userId: string; room: number };

/** Rızası sıfır olsa bile bir krallığın taşıdığı taban çekicilik payı. */
const ATTRACTIVENESS_FLOOR = .25;

/** Kesenin (`engine/agitation.ts`) yol süresine kıyasla daha uzun: halk taşınmak için para transferinden daha yavaştır. */
export const MIGRATION = {
  travelMinutes: 90,
} as const;

/** Göçmen kervanının yolda geçireceği gerçek süre; hızlı channel'da yol da kısalır. */
export const migrationTravelMs = (channelSpeed: number) =>
  Math.max(15_000, Math.round(MIGRATION.travelMinutes * 60_000 / Math.max(1, channelSpeed || 1)));

/**
 * Kapasitesi izin veren adaylar arasından TEK bir hedef seçer.
 *
 * Ağırlık = boş konut × çekicilik. Sıra tohumdan ÖNCE `userId`'ye göre sabitlenir
 * ki aynı ağırlık toplamında rulet ibresinin hangi dilime denk geldiği, adayların
 * DB'den hangi sırayla döndüğüne değil, kimliklerine bağlı olsun (aksi hâlde aynı
 * girdi farklı bir sorgu sırasıyla farklı bir hedef seçebilirdi).
 *
 * Aday yoksa ya da hiçbirinde boş konut kalmamışsa `null` döner: göçmenler yeni
 * bir yurt bulamaz (bugüne kadarki davranışın aynısı — kaybolurlar).
 */
export function pickMigrationTarget(candidates: MigrationCandidate[], seed: string): MigrationTarget | null {
  const open = candidates
    .map(candidate => ({
      userId: candidate.userId,
      room: Math.max(0, Math.floor(candidate.capacity - candidate.population)),
      popularity: candidate.popularity,
    }))
    .filter(candidate => candidate.room > 0)
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  if (!open.length) return null;

  const weights = open.map(candidate =>
    candidate.room * (ATTRACTIVENESS_FLOOR + (1 - ATTRACTIVENESS_FLOOR) * Math.max(0, Math.min(100, candidate.popularity)) / 100));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return null;

  const roll = rand01(seed) * total;
  let cursor = 0;
  for (let index = 0; index < open.length; index += 1) {
    cursor += weights[index];
    if (roll < cursor) return { userId: open[index].userId, room: open[index].room };
  }
  // Kayan nokta yuvarlaması yüzünden ibre son dilimi kılpayı aşarsa, en son
  // adaya düşer — matematiksel olarak toplamı geçemez ama emniyet içindir.
  const last = open[open.length - 1];
  return { userId: last.userId, room: last.room };
}

/** Hedefe fiilen varacak göçmen sayısı: talep edilenle boş konuttan küçük olanı. */
export function arrivingMigrants(count: number, room: number) {
  return Math.max(0, Math.min(Math.floor(count || 0), Math.floor(room || 0)));
}

/** Hedefin defterine düşen bildirim. Kimden geldiği söylenmez — bilgi sınırı korunur (bkz. engine/agitation.ts). */
export const migrationArrivalNotice = (count: number) =>
  `${count} kişi komşu bir sancaktan göç etti; nüfusunuz arttı.`;
