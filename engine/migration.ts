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
 * desenidir: bir krallıktaki bir olay, cron'da BAŞKA krallıkların kayıtlarına
 * sürüm korumalı olarak yazılır. Göçmenler tek bir kazanana yığılmaz; uygun
 * tüm hedeflere boş konut × çekicilik ağırlığıyla bölünür. Yerleşemeyenler
 * kaynak krallığa geri döner, dolayısıyla nüfus asla sessizce kaybolmaz.
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

export type MigrationAllocation = { userId: string; count: number };
export type MigrationDistribution = { allocations: MigrationAllocation[]; unplaced: number };

/** Rızası sıfır olsa bile bir krallığın taşıdığı taban çekicilik payı. */
const ATTRACTIVENESS_FLOOR = .25;

/** Kesenin (`engine/agitation.ts`) yol süresine kıyasla daha uzun: halk taşınmak için para transferinden daha yavaştır. */
export const MIGRATION = {
  travelMinutes: 90,
} as const;

/** Göçmen kervanının yolda geçireceği gerçek süre; hızlı channel'da yol da kısalır. */
export const migrationTravelMs = (channelSpeed: number) =>
  Math.max(15_000, Math.round(MIGRATION.travelMinutes * 60_000 / Math.max(1, channelSpeed || 1)));

/** Uygun hedefleri kararlı bir sırada, boş konut ve çekicilik ağırlığıyla hazırlar. */
function openCandidates(candidates: MigrationCandidate[]) {
  return candidates
    .map(candidate => ({
      userId: candidate.userId,
      room: Math.max(0, Math.floor(candidate.capacity - candidate.population)),
      popularity: candidate.popularity,
    }))
    .filter(candidate => candidate.room > 0)
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
    .map(candidate => ({
      ...candidate,
      weight: candidate.room * (ATTRACTIVENESS_FLOOR
        + (1 - ATTRACTIVENESS_FLOOR) * Math.max(0, Math.min(100, candidate.popularity)) / 100),
      count: 0,
    }));
}

/**
 * Göçmenleri BÜTÜN uygun krallıklara, boş konut × çekicilik oranıyla dağıtır.
 *
 * Büyük kesirler önce tam kişi olarak yazılır; kalan kişiler en büyük kesre göre
 * paylaştırılır. Bir hedef dolarsa kalanlar yeniden hesaplanır. Eşitlikte
 * `userId` kazanır; böylece DB sorgu sırası sonucu değiştirmez.
 */
export function distributeMigrants(candidates: MigrationCandidate[], count: number): MigrationDistribution {
  const wanted = Math.max(0, Math.floor(count || 0));
  const open = openCandidates(candidates);
  let remaining = Math.min(wanted, open.reduce((sum, candidate) => sum + candidate.room, 0));

  while (remaining > 0) {
    const active = open.filter(candidate => candidate.count < candidate.room);
    if (!active.length) break;
    const totalWeight = active.reduce((sum, candidate) => sum + candidate.weight, 0);
    if (totalWeight <= 0) break;

    const shares = active.map(candidate => {
      const exact = remaining * candidate.weight / totalWeight;
      const whole = Math.min(candidate.room - candidate.count, Math.floor(exact));
      return { candidate, exact, whole, fraction: exact - Math.floor(exact) };
    });
    let placedThisRound = 0;
    for (const share of shares) {
      share.candidate.count += share.whole;
      remaining -= share.whole;
      placedThisRound += share.whole;
    }
    if (!remaining) break;

    // Yuvarlama artıkları: her uygun hedef tur başına en fazla bir kişi alır.
    for (const share of shares
      .filter(share => share.candidate.count < share.candidate.room)
      .sort((a, b) => b.fraction - a.fraction || (a.candidate.userId < b.candidate.userId ? -1 : 1))) {
      if (!remaining) break;
      share.candidate.count += 1;
      remaining -= 1;
      placedThisRound += 1;
    }
    if (!placedThisRound) break;
  }

  return {
    allocations: open.filter(candidate => candidate.count > 0)
      .map(candidate => ({ userId: candidate.userId, count: candidate.count })),
    unplaced: wanted - open.reduce((sum, candidate) => sum + candidate.count, 0),
  };
}

/** Hedefin defterine düşen bildirim. Kimden geldiği söylenmez — bilgi sınırı korunur. */
export const migrationArrivalNotice = (count: number) =>
  `${count} kişi komşu bir sancaktan göç etti; nüfusunuz arttı.`;

/** Yer bulamayan göçmenin kaynak krallığın defterine dönüş bildirimi. */
export const migrationReturnNotice = (count: number) =>
  `${count} kişi yeni yurt bulamayınca krallığınıza geri döndü.`;
