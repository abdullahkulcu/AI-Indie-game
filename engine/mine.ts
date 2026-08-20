/**
 * Ortak madenin kuralları.
 *
 * Maden channel'ın ORTAK sahasıdır: bütün krallıklar aynı damara işçi yollar,
 * yuva sınırlıdır ve damar tükenir. Buradaki fonksiyonlar saftır — zaman ve
 * rastgelelik dışarıdan gelir — çünkü aynı hesabı hem `app/api/mine/route.ts`
 * hem testler çalıştırır.
 *
 * NEDEN AYRI BİR DOSYA: cevherin verimi tek bir yerde yazılı olmalı. Verim
 * eskiden yalnızca route'un içinde, tek satırda gömülüydü ve oyuncunun kaydına
 * hiç yansımıyordu; yani Kral işçi gönderiyor, madenciler tarladan eksiliyor
 * (bkz. `laborFactor`) ve karşılığında SIFIR cevher alıyordu.
 */

/** Bir işçinin saatte çıkardığı cevher. Channel hızıyla çarpılır. */
export const ORE_PER_WORKER_HOUR = 4;

/**
 * Tek hesapta ilerletilebilecek en uzun süre. Maden yalnızca birisi sayfaya
 * baktığında ilerler; bu tavan olmadan aylardır uyuyan bir channel ilk bakışta
 * damarı tek seferde boşaltırdı.
 */
export const MINE_ELAPSED_CAP_HOURS = 6;

/**
 * Cevherin oyuncunun kaydına yazılma aralığı.
 *
 * Cevher doğrudan `game_saves`'e yazılıyor (haraç ödemesindeki desen) ve her
 * yazma kaydın sürümünü artırıyor; Kralın açık sekmesi de 5 saniyede bir
 * kaydediyor. Her istekte teslimat yapılsaydı Kral saniyede bir 409 yiyip
 * sunucu kopyasına dönerdi. Bu yüzden cevher önce `pendingOre` içinde birikir,
 * kayda yalnızca bu aralıkta bir kez düşer: saatte en fazla 6 sürüm artışı.
 */
export const ORE_DELIVERY_INTERVAL_MS = 10 * 60_000;

/**
 * İki hesap arasındaki en kısa süre.
 *
 * Maden paneli 10 saniyede bir yokluyor ve her hesap madenin satırını + bütün
 * ekip satırlarını yazıyor. Bu eşik olmadan 60 kişilik bir ekipte tek bir açık
 * sekme dakikada 366 yazma üretirdi. Cevher kaybolmaz: eşiğin altındaki istek
 * hiçbir şey yazmaz, geçen süre `lastTickAt` üzerinde durur ve bir sonraki
 * hesapta bütünüyle sayılır.
 */
export const MINE_TICK_MIN_MS = 60_000;

/** Madende çalışan bir krallığın satırı. */
export type MineCrew = {
  userId: string;
  workers: number;
  /** Çıkarılmış ama henüz kayda yazılmamış cevher (kesirli olabilir). */
  pendingOre: number;
  /** Son teslimat anı; 0 ise hiç teslim edilmemiş demektir. */
  lastDeliveryAt: number;
};

export type MineShare = MineCrew & {
  /** Bu hesapta oyuncunun ambarına yazılacak tam sayı cevher. */
  delivered: number;
};

export type MineSettlement = {
  shares: MineShare[];
  /** Bu hesapta damardan çıkıp krallıklara teslim edilen toplam cevher. */
  extracted: number;
};

/** Bir krallığın saatlik cevher üretimi. */
export const oreRate = (workers: number, speed: number) =>
  Math.max(0, workers || 0) * ORE_PER_WORKER_HOUR * Math.max(1, speed || 1);

/**
 * Geçen sürenin cevherini paylaştırır ve teslim edilebilecek olanı ayırır.
 *
 * - Üretim işçi başınadır: kimse başkasının payını yemez.
 * - Damar bitmişse üretim durur; kalan cevher, HENÜZ TESLİM EDİLMEMİŞ paylar da
 *   sayılarak bölüştürülür, yani damar bir kez fazladan boşaltılamaz.
 * - Teslimat tam sayıdır; küsurat `pendingOre` içinde kalır ve kaybolmaz. Bu
 *   önemli: eski hesap her istekte `Math.floor` alıp kalanı çöpe atıyordu ve 10
 *   saniyede bir yoklanan bir madende 5 işçinin ürettiği hep 0'a yuvarlanıyordu.
 */
export function settleMine(crew: MineCrew[], input: {
  speed: number;
  hours: number;
  oreRemaining: number;
  now: number;
  /** İşçilerini çeken oyuncuya küsuratı beklemeden ödemek için. */
  forceUserId?: string | null;
}): MineSettlement {
  const hours = Math.max(0, Math.min(MINE_ELAPSED_CAP_HOURS, input.hours || 0));
  // Sıra sabit: damarın son cevheri her koşulda aynı kişiye gider, yani aynı
  // girdi aynı çıktıyı verir.
  const ordered = [...crew].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  const promised = ordered.reduce((total, row) => total + Math.max(0, row.pendingOre || 0), 0);
  let budget = Math.max(0, (input.oreRemaining || 0) - promised);

  let extracted = 0;
  const shares = ordered.map(row => {
    const mined = Math.min(budget, oreRate(row.workers, input.speed) * hours);
    budget -= mined;
    const pending = Math.max(0, row.pendingOre || 0) + mined;
    const due = row.userId === input.forceUserId
      || input.now - (row.lastDeliveryAt || 0) >= ORE_DELIVERY_INTERVAL_MS;
    // 1e-9: kesirli toplamada 3.0000000000000004 ya da 2.9999999999999996
    // farkı teslimatı bir cevher aşağı yuvarlamasın.
    const delivered = due ? Math.floor(pending + 1e-9) : 0;
    extracted += delivered;
    return { ...row, pendingOre: pending - delivered, delivered };
  });

  return { shares, extracted };
}
