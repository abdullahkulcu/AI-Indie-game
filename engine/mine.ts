import { rand01 } from "./raids";

/**
 * Ortak madenin kuralları.
 *
 * Maden channel'ın ORTAK sahasıdır: bütün krallıklar aynı damara işçi yollar,
 * yuva sınırlıdır ve damar tükenir. Buradaki fonksiyonlar saftır — zaman ve
 * rastgelelik dışarıdan gelir — çünkü aynı hesabı hem `app/api/mine/route.ts`
 * hem testler çalıştırır.
 *
 * NÜFUZ MÜCADELESİ — DOSYANIN KENDİ İLKESİNE GETİRİLEN BİLİNÇLİ İSTİSNA
 * (plan belgesi Fikir 22, karar 2026-08-22). Bu dosya kuruluşundan beri
 * "üretim işçi başınadır: kimse başkasının payını yemez" diyordu. O ilke
 * ARTIK KISMEN GEÇERSİZ ve bu yorum, CLAUDE.md'nin tek-doğru-kaynak
 * disiplini gereği sessizce eskimiş bırakılmadı — istisna ve SINIRLARI
 * açıkça şöyle:
 *   · Damarda en çok işçi bulunduran krallık "bölge sahibi" sayılır ve
 *     ÖTEKİLERİN AKTİF ÜRETİMİNDEN küçük bir pay (`INFLUENCE_CUT`) alır.
 *   · Ölçüt ANLIK İŞÇİ SAYISI DEĞİL: zaman ağırlıklı ortalama (`workerAvg`,
 *     zaman sabiti `INFLUENCE_AVG_TAU_GAME_HOURS`). Anlık olsaydı krallıklar
 *     her hesapta işçi sayısını oynatıp "sahiplik kapma" yarışına girerdi.
 *   · Sahiplik ayrıca PENCEREYE KİLİTLİDİR: mutlak zamana oturan
 *     `INFLUENCE_WINDOW_GAME_HOURS` uzunluğundaki pencerelerin başında bir
 *     kez tartılır ve pencere boyunca değişmez (akın penceresinin deseni).
 *   · Damardan çıkan TOPLAM cevher değişmez: pay yalnızca krallıklar arasında
 *     yer değiştirir, nüfuz cevher ÜRETMEZ.
 *   · Sahipliğin bedeli vardır: madende o an işçisi olmayan krallık pay
 *     alamaz — "işçini çek, kirayı yine topla" diye bir yol yok.
 *   · İlkenin geri kalanı yerinde: teslimat hâlâ tam sayıdır, küsurat
 *     kaybolmaz, damar bir kez fazladan boşaltılamaz, sıra userId'ye göre
 *     sabittir.
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

/**
 * NÜFUZ SABİTLERİ (Fikir 22). Hepsi burada, tek kaynakta; ne route ne panel
 * kendi kopyasını tutar.
 */
/** Bölge sahibinin ÖTEKİLERİN üretiminden aldığı pay. Küçük tutulur: bu bir
 * avantaj, bir haraç değil. */
export const INFLUENCE_CUT = .1;
/** Ortalamanın zaman sabiti (OYUN saati): "son bir gün" ölçeği. */
export const INFLUENCE_AVG_TAU_GAME_HOURS = 24;
/** Sahipliğin tartıldığı pencere (OYUN saati); pencere içinde sahip değişmez. */
export const INFLUENCE_WINDOW_GAME_HOURS = 6;
/** Sahip olabilmek için gereken ortalama işçi tabanı. */
export const INFLUENCE_MIN_AVG_WORKERS = 5;
/** İkinciye karşı gereken üstünlük: "en çok" kılpayı değil, açık olmalı. */
export const INFLUENCE_DOMINANCE = 1.25;

/** Madende çalışan bir krallığın satırı. */
export type MineCrew = {
  userId: string;
  workers: number;
  /** Çıkarılmış ama henüz kayda yazılmamış cevher (kesirli olabilir). */
  pendingOre: number;
  /** Son teslimat anı; 0 ise hiç teslim edilmemiş demektir. */
  lastDeliveryAt: number;
  /**
   * Zaman ağırlıklı ortalama işçi sayısı; nüfuz mücadelesinin ÖLÇÜTÜ.
   * Alan yoksa 0 kabul edilir: yeni bir satır (ve bu sütun eklenmeden önceki
   * bütün satırlar) sahipliği sıfırdan kazanmak zorundadır.
   */
  workerAvg?: number;
};

export type MineShare = MineCrew & {
  /** Bu hesapta oyuncunun ambarına yazılacak tam sayı cevher. */
  delivered: number;
  /** Hesaptan sonraki ortalama; çağıran bunu satıra geri yazar. */
  workerAvg: number;
};

/** Pencereye kilitli bölge sahipliği; çağıran madenin satırına geri yazar. */
export type MineInfluence = {
  /** Bölge sahibi; kimse hak etmiyorsa null. */
  userId: string | null;
  /** Sahipliğin tartıldığı pencerenin indeksi (mutlak zamana oturur). */
  window: number;
};

export type MineSettlement = {
  shares: MineShare[];
  /** Bu hesapta damardan çıkıp krallıklara teslim edilen toplam cevher. */
  extracted: number;
  /** Hesabın sonundaki sahiplik durumu. */
  influence: MineInfluence;
};

/** Pencere uzunluğu GERÇEK zamanda; oyun saati channel hızıyla ölçeklenir. */
export const influenceWindowMs = (speed: number) =>
  INFLUENCE_WINDOW_GAME_HOURS * 3_600_000 / Math.max(1, speed || 1);

/** Mutlak zamana oturan pencere indeksi — akın penceresiyle aynı fikir. */
export const influenceWindowAt = (now: number, speed: number) =>
  Math.floor(now / influenceWindowMs(speed));

/**
 * Ortalamanın kapalı çözümü: `avg' = hedef + (avg − hedef)·e^(−Δt/τ)`.
 *
 * KISIT #2 (adım-bölünmesi bağımsızlığı) buradan geçer: üstel yakınsama
 * bölünebilir — Δ1 sonra Δ2 uygulamak, Δ1+Δ2 uygulamakla AYNI sonucu verir
 * (`engine/faction.ts`'in `advanceFaction`'ı ile aynı gerekçe). Ortalamayı
 * "her hesapta biraz kaydır" gibi adım sayısına bağlı bir formülle yazmak
 * madenin payını hesabın kaç parçaya bölündüğüne bağlardı.
 */
export function advanceWorkerAvg(current: number, workers: number, gameHours: number) {
  const target = Math.max(0, workers || 0);
  const previous = Math.max(0, current || 0);
  if (gameHours <= 0) return previous;
  const decay = Math.exp(-gameHours / INFLUENCE_AVG_TAU_GAME_HOURS);
  return target + (previous - target) * decay;
}

/**
 * BÖLGE SAHİBİ — pencerenin başında bir kez tartılır.
 *
 * Üç şart birlikte aranır ve üçü de bilinçli bir istismar frenidir:
 *  1. Ortalama işçi tabanı (`INFLUENCE_MIN_AVG_WORKERS`): iki işçiyle bölge
 *     sahibi olunmaz.
 *  2. İkinciye açık üstünlük (`INFLUENCE_DOMINANCE`): kılpayı öndeki krallık
 *     sahiplik almaz, yoksa pencere başlarında bir yuva sniping yarışı doğar.
 *  3. O AN madende işçisi olmak: ortalaması yüksek olduğu için işçilerini
 *     çekip pay toplamaya devam eden "gıyabında sahip" olamaz.
 * Eşitlikte kimse sahip olmaz; sıra/hile ile kazanılacak bir avantaj değil.
 */
export function dominantMiner(crew: ReadonlyArray<Pick<MineCrew, "userId" | "workers" | "workerAvg">>): string | null {
  const ranked = crew
    .map(row => ({ userId: row.userId, avg: Math.max(0, row.workerAvg ?? 0), workers: Math.max(0, row.workers || 0) }))
    // Sıra userId'ye göre sabit: aynı girdi aynı çıktıyı verir.
    .sort((a, b) => (b.avg - a.avg) || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  const [first, second] = ranked;
  if (!first || !second) return null;
  if (first.workers <= 0) return null;
  if (first.avg < INFLUENCE_MIN_AVG_WORKERS) return null;
  if (first.avg < second.avg * INFLUENCE_DOMINANCE) return null;
  return first.userId;
}

/** Bir krallığın saatlik cevher üretimi. */
export const oreRate = (workers: number, speed: number) =>
  Math.max(0, workers || 0) * ORE_PER_WORKER_HOUR * Math.max(1, speed || 1);

/**
 * Geçen sürenin cevherini paylaştırır ve teslim edilebilecek olanı ayırır.
 *
 * - Üretim işçi başınadır; TEK İSTİSNA bölge sahibinin payıdır (dosya başındaki
 *   "NÜFUZ MÜCADELESİ" notu ve `INFLUENCE_CUT`). Sahip yoksa hesap eskisiyle
 *   birebir aynıdır.
 * - Damar bitmişse üretim durur; kalan cevher, HENÜZ TESLİM EDİLMEMİŞ paylar da
 *   sayılarak bölüştürülür, yani damar bir kez fazladan boşaltılamaz.
 * - Teslimat tam sayıdır; küsurat `pendingOre` içinde kalır ve kaybolmaz. Bu
 *   önemli: eski hesap her istekte `Math.floor` alıp kalanı çöpe atıyordu ve 10
 *   saniyede bir yoklanan bir madende 5 işçinin ürettiği hep 0'a yuvarlanıyordu.
 *
 * ADIM-BÖLÜNMESİ BAĞIMSIZLIĞI (CLAUDE.md kısıt #2) üç şeye dayanır ve
 * `tests/mine.test.ts` üçünü de tutar:
 *  1. Üretim süreyle DOĞRUSALDIR, pay sabit bir orandır → parçaların toplamı
 *     bütüne eşittir.
 *  2. Ortalama KAPALI ÇÖZÜMLÜ üsteldir (`advanceWorkerAvg`) → bölünebilir.
 *  3. Sahiplik, mutlak zamana oturan pencerelere KİLİTLİ ve pencere sınırında
 *     yeniden tartılıyor; hesap bu sınırlardan bölünerek yürütülüyor. Sahip
 *     "hesabın başındaki ortalamaya" göre seçilseydi, pencerenin ortasından
 *     bölünen bir hesap farklı bir sahip bulabilirdi.
 */
export function settleMine(crew: MineCrew[], input: {
  speed: number;
  hours: number;
  oreRemaining: number;
  now: number;
  /** İşçilerini çeken oyuncuya küsuratı beklemeden ödemek için. */
  forceUserId?: string | null;
  /** Madenin satırında duran, pencereye kilitli sahiplik. Yoksa yeniden tartılır. */
  influence?: MineInfluence | null;
}): MineSettlement {
  const hours = Math.max(0, Math.min(MINE_ELAPSED_CAP_HOURS, input.hours || 0));
  const speed = Math.max(1, input.speed || 1);
  // Sıra sabit: damarın son cevheri her koşulda aynı kişiye gider, yani aynı
  // girdi aynı çıktıyı verir.
  const ordered = [...crew].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  const promised = ordered.reduce((total, row) => total + Math.max(0, row.pendingOre || 0), 0);
  let budget = Math.max(0, (input.oreRemaining || 0) - promised);

  const mined = new Map<string, number>(ordered.map(row => [row.userId, 0]));
  const avg = new Map<string, number>(ordered.map(row => [row.userId, Math.max(0, row.workerAvg ?? 0)]));
  let influence: MineInfluence = input.influence?.userId !== undefined
    ? { userId: input.influence.userId, window: input.influence.window }
    : { userId: null, window: influenceWindowAt(input.now - hours * 3_600_000, speed) };

  const windowMs = influenceWindowMs(speed);
  // Hesap pencere SINIRLARINDAN bölünerek yürür. Segment sayısı geçen sürenin
  // tavanıyla (MINE_ELAPSED_CAP_HOURS) sınırlı olduğu için en kötü hâlde
  // birkaç düzine tur döner; yine de bir emniyet kemeri var.
  const MAX_SEGMENTS = 64;
  let cursor = input.now - hours * 3_600_000;
  for (let segment = 0; segment < MAX_SEGMENTS && cursor < input.now; segment += 1) {
    const window = influenceWindowAt(cursor, speed);
    const end = Math.min(input.now, (window + 1) * windowMs);
    const segmentHours = (end - cursor) / 3_600_000;
    // YENİ PENCERE: sahiplik tam bu anın ortalamalarıyla tartılır ve pencere
    // boyunca donar.
    if (window !== influence.window) {
      influence = { userId: dominantMiner(ordered.map(row => ({ userId: row.userId, workers: row.workers, workerAvg: avg.get(row.userId) ?? 0 }))), window };
    }
    // Üretim ve pay AYNI segmentte hesaplanır; sahibin payı ötekilerin bu
    // segmentte çıkardığı cevherden alınır, damardan fazladan bir şey ÇIKMAZ.
    let tribute = 0;
    for (const row of ordered) {
      const produced = Math.min(budget, oreRate(row.workers, speed) * segmentHours);
      budget -= produced;
      const cut = influence.userId && row.userId !== influence.userId ? produced * INFLUENCE_CUT : 0;
      tribute += cut;
      mined.set(row.userId, (mined.get(row.userId) ?? 0) + produced - cut);
    }
    if (influence.userId && tribute > 0) mined.set(influence.userId, (mined.get(influence.userId) ?? 0) + tribute);
    // Ortalama segmentin SONUNDA ilerler: bir sonraki pencerenin sahibi, o
    // pencerenin başındaki ortalamayla seçilsin.
    for (const row of ordered) avg.set(row.userId, advanceWorkerAvg(avg.get(row.userId) ?? 0, row.workers, segmentHours * speed));
    cursor = end;
  }

  let extracted = 0;
  const shares = ordered.map(row => {
    const pending = Math.max(0, row.pendingOre || 0) + (mined.get(row.userId) ?? 0);
    const due = row.userId === input.forceUserId
      || input.now - (row.lastDeliveryAt || 0) >= ORE_DELIVERY_INTERVAL_MS;
    // 1e-9: kesirli toplamada 3.0000000000000004 ya da 2.9999999999999996
    // farkı teslimatı bir cevher aşağı yuvarlamasın.
    const delivered = due ? Math.floor(pending + 1e-9) : 0;
    extracted += delivered;
    return { ...row, pendingOre: pending - delivered, delivered, workerAvg: avg.get(row.userId) ?? 0 };
  });

  return { shares, extracted, influence };
}

/**
 * DAMAR TÜKENİNCE ÇIKAN FIRSAT (plan belgesi Fikir 23).
 *
 * Madenin bitmesi bir SON değil, yeni bir olayın başlangıcı: aynı bölgede
 * tematik bir keşif (define, yıkık kale, terk edilmiş galeri) belirir.
 *
 * ÜÇ KARAR, ÜÇÜ DE PLANDAN:
 *  1. Fırsatın türü/büyüklüğü/konumu TOHUMLU — `rand01` deseniyle
 *     deterministik, admin müdahalesi gerekmez. Satırda YALNIZCA tohumun
 *     girdileri saklanır (channel + tükenme anı); tür ve miktar her okumada
 *     buradan TÜRETİLİR. Böylece ödülün sayısı hiçbir yerde ikinci bir kopya
 *     olarak durmaz ve istemcinin şişirebileceği bir alan hiç var olmaz.
 *  2. GERÇEK BİR YARIŞ: tek kazanan tüm fırsatı alır. Fikir 22'nin sürekli
 *     paylaşımlı doğasından bilinçli olarak farklı bir ton — maden işbirlikçi
 *     ve rekabetçi, tükenme-sonrası olay tek-kazananlı; ikisi farklı anları
 *     temsil eder, tutarsızlık değildir.
 *  3. Kaçırılırsa BEKLEYEN kalır, sonradan da alınabilir (affedici tasarım).
 *
 * TOHUMUN ANI NEDEN KABA (`MINE_FIND_SEED_BUCKET_MS`): tükenme anını, damarın
 * son cevherini alan oyuncu bir ölçüde SEÇEBİLİR (maden yalnızca birisi
 * sayfaya baktığında ilerler). Milisaniye hassasiyetinde bir tohum, "hangi
 * milisaniyede yoklarsam define çıkar" diye taranabilirdi. An bir oyun saatine
 * yuvarlandı ve ödül bantları da bilinçli olarak dar tutuldu: tohum avlamak
 * kârlı bir iş olmasın.
 */
export type MineFindKind = "define" | "yikik_kale" | "terk_galeri";

export const MINE_FIND_KINDS = ["define", "yikik_kale", "terk_galeri"] as const;

/** Tohumun anını yuvarlama aralığı: bir oyun saati. */
export const MINE_FIND_SEED_BUCKET_GAME_HOURS = 1;

export const MINE_FINDS: Record<MineFindKind, {
  label: string;
  text: string;
  /** Ödül hangi kaleme yazılır. */
  resource: "gold" | "stone" | "iron";
  /** Ödül bandı; dar tutulur ki tohum avlamak kârlı olmasın. */
  min: number;
  max: number;
}> = {
  define: {
    label: "Define",
    text: "Terk edilmiş galerinin dibinde, eski bir hükümdarın gömdüğü sikke küpü.",
    resource: "gold", min: 600, max: 900,
  },
  yikik_kale: {
    label: "Yıkık Kale",
    text: "Damarın üstündeki sırtta, taşları hâlâ sağlam bir yıkık gözcü kalesi.",
    resource: "stone", min: 500, max: 800,
  },
  terk_galeri: {
    label: "Terk Edilmiş Galeri",
    text: "Damar bitti ama yan kolda kimsenin dokunmadığı bir cevher damarı kalmış.",
    resource: "iron", min: 450, max: 700,
  },
};

/** Tükenme anını kaba bir kovaya oturtur; tohum bundan kurulur. */
export function mineFindSeedAt(now: number, speed: number) {
  const bucket = MINE_FIND_SEED_BUCKET_GAME_HOURS * 3_600_000 / Math.max(1, speed || 1);
  return Math.floor(now / bucket) * bucket;
}

export type MineFind = {
  kind: MineFindKind;
  label: string;
  text: string;
  resource: "gold" | "stone" | "iron";
  amount: number;
  /** Madenin çevresindeki konum sapması; harita/panel bunu maden konumuna ekler. */
  offset: { x: number; z: number };
};

/**
 * Tohumdan fırsatı türetir. Aynı channel + aynı tükenme kovası ⇒ aynı fırsat;
 * yeniden yüklemek ya da başka bir oyuncunun bakması sonucu değiştirmez.
 */
export function mineFindOf(seed: string): MineFind {
  const kind = MINE_FIND_KINDS[Math.min(MINE_FIND_KINDS.length - 1, Math.floor(rand01(`${seed}:tur`) * MINE_FIND_KINDS.length))];
  const catalog = MINE_FINDS[kind];
  const amount = Math.round(catalog.min + rand01(`${seed}:miktar`) * (catalog.max - catalog.min));
  return {
    kind,
    label: catalog.label,
    text: catalog.text,
    resource: catalog.resource,
    amount,
    offset: {
      x: Math.round((rand01(`${seed}:x`) - .5) * 24 * 10) / 10,
      z: Math.round((rand01(`${seed}:z`) - .5) * 24 * 10) / 10,
    },
  };
}
