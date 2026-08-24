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
 * hedefe gider; göç TEK bir kaynaktan channel'daki TÜM uygun adaylara
 * DAĞILIR — başlıktaki "çok krallığa dağılması" tam olarak budur.
 *
 * NEDEN HİÇ ZAR YOK: akınlar (`engine/raids.ts`) doğanın kendiliğinden gelen
 * bir olayıdır ve "olur mu olmaz mı" sorusuna cevap arar; göç ise HANGİ
 * krallığın göçmeni ÇEKTİĞİ sorusuna cevap arayan bir EKONOMİK tercihtir (boş
 * konut + rıza). Kervan bölünebildiği için soruyu cevaplamak için kura
 * çekmeye gerek yok: `spreadMigrants` kişileri ağırlıklara ORANLA paylaştırır
 * ve artan kişileri EN BÜYÜK KALAN yöntemiyle dağıtır. Tamamen belirlenimci —
 * ne tohum ne zar; aynı girdi hep aynı dağılımı verir, save-scum işe yaramaz.
 *
 * ÖNCEKİ HÂLİ VE NEDEN DEĞİŞTİ: ilk sürüm rulet çarkıyla TEK bir hedef
 * seçiyordu (`pickMigrationTarget`) ve hedef bulunamazsa göçmenler
 * KAYBOLUYORDU. Kaybolma nadir bir uç durum değildi: tek kişilik bir
 * channel'da aday listesi HER ZAMAN boştur, yani her göç dalgası halkın
 * silinmesiyle sonuçlanıyordu. Artık kimse kaybolmaz — bkz. `spreadMigrants`
 * dönüşündeki `returning`.
 *
 * KAPASİTE TAVANI: hedefin boş konutu (`capacity - population`) sıfırın
 * altındaysa aday listesinden düşer, ve hiçbir hedefe boş konutundan FAZLA
 * kişi yazılmaz — "Kapasiteyi aşan bir krallığa göçmen gitmemeli" kısıtı
 * burada uygulanır (bkz. engine/tick.ts → capacityFor).
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

/** Bir hedefe düşen pay. */
export type MigrationAllocation = { userId: string; count: number };

export type MigrationSpread = {
  /** Boş konutu olan hedeflere düşen paylar; payı sıfır olan hedef listeye girmez. */
  allocations: MigrationAllocation[];
  /**
   * Hiçbir hedefte yer bulamayan kişi sayısı. KAYIP DEĞİLDİR: çağıran taraf
   * (bkz. app/api/cron/route.ts → settleMigrations) bunları kaynağa geri
   * döndürmek zorundadır. Bu alanın adı bilinçli olarak "lost" değil
   * "returning": kimsenin silinmediğini tip düzeyinde söyler.
   */
  returning: number;
};

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
 * Kervanı, boş konutu olan TÜM adaylara ağırlıklarına ORANLA paylaştırır.
 *
 * Ağırlık = boş konut × çekicilik. Boş konutu 0 ya da eksi olan aday listeden
 * düşer; kalanların her birine ağırlık payı kadar kişi yazılır ve HİÇBİRİNE
 * kendi boş konutundan fazlası yazılmaz.
 *
 * ARTAN KİŞİLER — EN BÜYÜK KALAN: oranlı pay neredeyse hiçbir zaman tam sayı
 * çıkmaz (30 kişi, ağırlıkları 2:1 olan iki hedef → 20 ve 10 değil, 20.0 ve
 * 10.0 gibi şanslı durumlar dışında 19.7 ve 10.3). Tabana yuvarlanan payların
 * ardından artan kişiler, ONDALIK KALANI EN BÜYÜK olandan başlanarak birer
 * birer dağıtılır. Kalanı eşit olanlarda sıra `userId`'ye göre kırılır. Böylece
 * hem toplam korunur (tek kişi bile buharlaşmaz) hem de sonuç adayların DB'den
 * hangi sırayla döndüğünden bağımsız kalır.
 *
 * Sıra `userId`'ye göre sabitlenir: aksi hâlde aynı girdi, farklı bir sorgu
 * sırasıyla farklı bir dağılım verebilirdi.
 *
 * Aday yoksa (tek kişilik channel, herkesin kapasitesi dolu, ya da tüm adaylar
 * kuruluş korumasında) `allocations` boş döner ve HERKES `returning` olur.
 * Çağıran tarafın bunları kaynağa geri döndürmesi zorunludur — bu fonksiyon
 * hiçbir koşulda kişi SİLMEZ; girdinin toplamı çıktının toplamına eşittir.
 */
export function spreadMigrants(count: number, candidates: MigrationCandidate[]): MigrationSpread {
  const total = Math.max(0, Math.floor(count || 0));
  if (total <= 0) return { allocations: [], returning: 0 };

  const open = candidates
    .map(candidate => ({
      userId: candidate.userId,
      room: Math.max(0, Math.floor(candidate.capacity - candidate.population)),
      popularity: Math.max(0, Math.min(100, candidate.popularity)),
      share: 0,
      given: 0,
    }))
    .filter(candidate => candidate.room > 0)
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  if (!open.length) return { allocations: [], returning: total };

  const weights = open.map(candidate =>
    candidate.room * (ATTRACTIVENESS_FLOOR + (1 - ATTRACTIVENESS_FLOOR) * candidate.popularity / 100));
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum <= 0) return { allocations: [], returning: total };

  let placed = 0;
  open.forEach((candidate, index) => {
    candidate.share = total * weights[index] / weightSum;
    candidate.given = Math.min(candidate.room, Math.floor(candidate.share));
    placed += candidate.given;
  });

  // Artan kişiler kalanı en büyük olandan başlayarak dağıtılır. Bir tam turda
  // hiç kimse yerleşemediyse (kalan herkesin konutu dolmuş) döngü kırılır;
  // artakalanlar `returning` olur.
  const byRemainder = [...open].sort((a, b) => {
    const remainderA = a.share - Math.floor(a.share), remainderB = b.share - Math.floor(b.share);
    if (remainderB !== remainderA) return remainderB - remainderA;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
  while (placed < total) {
    let moved = false;
    for (const candidate of byRemainder) {
      if (placed >= total) break;
      if (candidate.given >= candidate.room) continue;
      candidate.given += 1; placed += 1; moved = true;
    }
    if (!moved) break;
  }

  return {
    allocations: open.filter(candidate => candidate.given > 0)
      .map(candidate => ({ userId: candidate.userId, count: candidate.given })),
    returning: total - placed,
  };
}

/**
 * HEDEFİN defterine düşen bildirim. Geldikleri sancağın ADINI SÖYLER.
 *
 * BİLGİ SINIRI BURADA ASİMETRİKTİR VE BU BİLİNÇLİ. Dış kese
 * (`engine/agitation.ts`) gönderenin adını saklar, çünkü kese gizlice
 * gönderilir. Göç öyle değil: halk hedefin SINIRINDAN GEÇEREK gelir, yani
 * karşılayan Kral onlara nereden geldiklerini sorabilir. Saklamak fiziksel
 * olarak tutarsız olurdu.
 *
 * Ters yön saklı KALIR: göç edenin kaynağı, halkının nereye gittiğini
 * ÖĞRENMEZ (bkz. `migrationReturnNotice`). Kral kendi sınırından çıkanı
 * uğurlar, komşunun sınırından geçtiğini görmez.
 *
 * Ad sızıntısı değil: `displayNameOf` adı PUBLIC projeksiyondan okur
 * (`server/world-projection.ts` → `projectPublicKingdom`), yani dünya
 * haritasının zaten gösterdiği bilgi. Yeni bir istihbarat kanalı açılmıyor,
 * var olan bilgi okunabilir hâle geliyor.
 *
 * EK SESSİZLİK: sancağın nüfusunun ne kadar eridiği söylenmez, yalnızca
 * "buradan geldiler". Kaç kişi geldiği hedefin kendi sayımıdır.
 *
 * `from` boşsa (kaynağın kaydı okunamıyor, hesabı silinmiş) eski, adsız
 * cümleye düşer — bildirim hiç yazılmamaktan iyidir.
 */
export const migrationArrivalNotice = (count: number, from = "") =>
  from
    ? `${count} kişi ${from} sancağından göç etti; sınırınızdan geçip yerleştiler.`
    : `${count} kişi komşu bir sancaktan göç etti; nüfusunuz arttı.`;

/**
 * KAYNAĞIN defterine düşen bildirim: gidecek yer bulamayıp geri dönen halk.
 *
 * Nereye gitmeye çalıştıkları SÖYLENMEZ ve bu, varış bildiriminin tam
 * tersidir (bkz. `migrationArrivalNotice`): gelen halk hedefin sınırından
 * geçtiği için adres verir, giden halk kendi Kralına adres bırakmaz. Kral
 * komşularının konut durumunu göçmenlerinin dönüşünden öğrenmez.
 *
 * Cümle SEBEBİ söyler ("yer bulamadı") çünkü Kralın gördüğü tek şey nüfusunun
 * geri gelmesi olurdu ve bunu bir hata sanabilirdi.
 */
export const migrationReturnNotice = (count: number) =>
  `Göç eden ${count} kişi kendine yeni bir yurt bulamadı ve geri döndü.`;
