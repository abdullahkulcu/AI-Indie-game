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

/** Her yeni damar için ortak cevher stoğu. Veritabanı varsayılanı da bu sabiti izler. */
export const SHARED_MINE_ORE_CAPACITY = 100_000;

/** Bir maden nüfuz penceresi, üretim yapılmış 24 oyun saatini kapsar. */
export const MINE_INFLUENCE_WINDOW_HOURS = 24;
/** Nüfuz sahibi, rakiplerin o andaki üretiminin bu payını kendi hanesine çeker. */
export const MINE_INFLUENCE_TAKE_RATE = .1;

export type MineSite = {
  vein: number;
  name: string;
  position: { x: number; z: number };
};

/**
 * Ortak madenin ardışık sahaları.
 *
 * Yeni damarlar rastgele seçilmez: channel kimliği ve damar sırası aynıysa aynı
 * saha seçilir. Böylece sunucu yeniden başlasa ya da iki Kral aynı anda haritayı
 * açsa dahi dünyanın bir sonraki cevabı değişmez.
 */
const MINE_SITES = [
  { name: "Ortak Demir Damarı", position: { x: -52, z: 8 } },
  { name: "Kuzey Sırtı Demir Damarı", position: { x: 37, z: -42 } },
  { name: "Karaorman Demir Ocağı", position: { x: -44, z: 36 } },
  { name: "Akçay Yamaç Damarı", position: { x: 48, z: 29 } },
  { name: "Taşpınar Demir Katmanı", position: { x: 8, z: -55 } },
] as const;

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (const char of seed) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

/** Bir channel'ın belirtilen damar sırası için kalıcı maden sahası. */
export function mineSiteFor(channelId: string, vein: number): MineSite {
  const safeVein = Math.max(0, Math.floor(vein));
  // İlk saha, eski kayıtların alıştığı konumda kalır. Sonrakiler channel'a göre
  // farklı bir sırayla döner; bütün dünyalar aynı noktada yığılmaz.
  const index = safeVein === 0
    ? 0
    : 1 + (hashSeed(channelId) + safeVein - 1) % (MINE_SITES.length - 1);
  const site = MINE_SITES[index];
  return { vein: safeVein, name: site.name, position: { ...site.position } };
}

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

/** Son 24 üretim oyun-saatindeki emek kaydı. İşçi ayrılsa bile pencere kapanana kadar kalır. */
export type MineInfluenceSample = { userId: string; workerHours: number };

export type MineInfluenceAdvance = {
  samples: MineInfluenceSample[];
  /** Pencerede biriken üretim oyun-saatleri. */
  gameHours: number;
  /** Bir sonraki pencerede aktif üretimden pay alacak krallık. */
  ownerUserId: string | null;
};

/**
 * İşçi sayısını anlık değil, üretim yapılmış son 24 oyun saatinin ortalaması
 * üzerinden nüfuz sahibi yapar. Döngü zaman sınırlarını tek tek böler; bu
 * yüzden altı kısa hesap ile tek büyük hesap aynı sahibi seçer.
 */
export function advanceMineInfluence(input: {
  crew: ReadonlyArray<Pick<MineCrew, "userId" | "workers">>;
  samples: ReadonlyArray<MineInfluenceSample>;
  gameHours: number;
  elapsedGameHours: number;
  ownerUserId: string | null;
}): MineInfluenceAdvance {
  const credits = new Map(input.samples.map(sample => [sample.userId, Math.max(0, sample.workerHours || 0)]));
  const workers = [...input.crew].sort((a, b) => a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);
  let progress = Math.max(0, Math.min(MINE_INFLUENCE_WINDOW_HOURS, input.gameHours || 0));
  let left = Math.max(0, input.elapsedGameHours || 0);
  let ownerUserId = input.ownerUserId;
  while (left > 1e-9) {
    const slice = Math.min(left, MINE_INFLUENCE_WINDOW_HOURS - progress || MINE_INFLUENCE_WINDOW_HOURS);
    for (const worker of workers) credits.set(worker.userId, (credits.get(worker.userId) ?? 0) + Math.max(0, worker.workers) * slice);
    progress += slice;
    left -= slice;
    if (progress + 1e-9 < MINE_INFLUENCE_WINDOW_HOURS) continue;
    const ranked = [...credits.entries()].filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    ownerUserId = ranked[0]?.[0] ?? null;
    credits.clear();
    progress = 0;
  }
  return {
    samples: [...credits.entries()].map(([userId, workerHours]) => ({ userId, workerHours })).sort((a, b) => a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
    gameHours: progress,
    ownerUserId,
  };
}

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
  /** Önceki pencerenin nüfuz sahibi; yalnız aktif üreticilerden pay alabilir. */
  influenceOwnerId?: string | null;
}): MineSettlement {
  const hours = Math.max(0, Math.min(MINE_ELAPSED_CAP_HOURS, input.hours || 0));
  // Sıra sabit: damarın son cevheri her koşulda aynı kişiye gider, yani aynı
  // girdi aynı çıktıyı verir.
  const ordered = [...crew].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  const promised = ordered.reduce((total, row) => total + Math.max(0, row.pendingOre || 0), 0);
  let budget = Math.max(0, (input.oreRemaining || 0) - promised);

  const gross = ordered.map(row => {
    const mined = Math.min(budget, oreRate(row.workers, input.speed) * hours);
    budget -= mined;
    return mined;
  });
  const ownerIndex = input.influenceOwnerId ? ordered.findIndex(row => row.userId === input.influenceOwnerId && row.workers > 0) : -1;
  const taken = ownerIndex < 0 ? 0 : gross.reduce((sum, mined, index) => index === ownerIndex ? sum : sum + mined * MINE_INFLUENCE_TAKE_RATE, 0);
  let extracted = 0;
  const shares = ordered.map((row, index) => {
    const adjusted = ownerIndex < 0 ? gross[index] : index === ownerIndex ? gross[index] + taken : gross[index] * (1 - MINE_INFLUENCE_TAKE_RATE);
    const pending = Math.max(0, row.pendingOre || 0) + adjusted;
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
