import assert from "node:assert/strict";
import test from "node:test";
import {
  INFLUENCE_AVG_TAU_GAME_HOURS, INFLUENCE_CUT, INFLUENCE_DOMINANCE, INFLUENCE_MIN_AVG_WORKERS,
  ORE_PER_WORKER_HOUR, advanceWorkerAvg, dominantMiner, influenceWindowAt, influenceWindowMs,
  settleMine, type MineCrew, type MineInfluence,
} from "../engine/mine";

/**
 * ORTAK MADENDE NÜFUZ MÜCADELESİ (plan belgesi Fikir 22).
 *
 * Dosyanın eski ilkesi ("kimse başkasının payını yemez") bilinçli olarak
 * kısmen terk edildi. Bu testler istisnanın SINIRLARINI tutar: pay aktif
 * üretimden alınır ama cevher ÜRETİLMEZ, ölçüt anlık değil ortalamadır,
 * sahiplik pencereye kilitlidir ve hesap adım-bölünmesinden bağımsızdır
 * (CLAUDE.md kısıt #2).
 */

const WINDOW_MS = influenceWindowMs(1);
/** Pencere sınırına oturan bir an: bölünme testleri sınırın iki yanını görür. */
const BOUNDARY = WINDOW_MS * 83_333;

const crew = (overrides: Partial<MineCrew> = {}): MineCrew =>
  ({ userId: "u1", workers: 5, pendingOre: 0, lastDeliveryAt: 0, workerAvg: 0, ...overrides });

const held = (workers: number) => workers; // okunabilirlik için: uzun süre tutulmuş işçi
const settledAvg = (workers: number) => held(workers); // ortalama hedefe yakınsar

// --- ortalama: kapalı çözüm -------------------------------------------------

test("ortalama kapalı çözümlüdür: parçalara bölmek sonucu değiştirmez", () => {
  // KISIT #2'nin özü. "Her hesapta biraz kaydır" biçiminde yazılsaydı madenin
  // payı hesabın kaç parçaya bölündüğüne bağlı olurdu.
  const single = advanceWorkerAvg(0, 20, 6);
  let split = 0;
  for (let step = 0; step < 12; step += 1) split = advanceWorkerAvg(split, 20, .5);
  assert.ok(Math.abs(single - split) < 1e-9, `sapma: ${single} vs ${split}`);
});

test("ortalama hedefe yakınsar ama anında ulaşmaz", () => {
  assert.equal(advanceWorkerAvg(0, 30, 0), 0, "süre geçmediyse ortalama oynamaz");
  const oneTau = advanceWorkerAvg(0, 30, INFLUENCE_AVG_TAU_GAME_HOURS);
  assert.ok(oneTau > 15 && oneTau < 25, `bir zaman sabitinde beklenen ~%63: ${oneTau}`);
  assert.ok(advanceWorkerAvg(0, 30, 1) < 2, "tek oyun saatinde ortalama fırlamaz");
  // İşçiler çekilince ortalama erir; sahiplik kendiliğinden düşer.
  assert.ok(advanceWorkerAvg(30, 0, INFLUENCE_AVG_TAU_GAME_HOURS) < 15);
  assert.ok(advanceWorkerAvg(-5, 10, 1) >= 0, "bozuk değer negatife düşmez");
});

// --- sahiplik ölçütü --------------------------------------------------------

test("bölge sahibi olmak için açık üstünlük ve gerçek işçi gerekir", () => {
  const big = { userId: "a", workers: 20, workerAvg: settledAvg(20) };
  const small = { userId: "b", workers: 4, workerAvg: settledAvg(4) };
  assert.equal(dominantMiner([big, small]), "a");
  // Tek başına çalışan sahiplik almaz: kimsenin payını yiyemez.
  assert.equal(dominantMiner([big]), null);
  // Kılpayı öndeki sahiplik almaz (pencere başlarında sniping yarışını önler).
  const close = INFLUENCE_MIN_AVG_WORKERS * 2;
  assert.equal(dominantMiner([
    { userId: "a", workers: 10, workerAvg: close * INFLUENCE_DOMINANCE * .95 },
    { userId: "b", workers: 10, workerAvg: close },
  ]), null);
  // Eşitlikte kimse sahip olmaz.
  assert.equal(dominantMiner([
    { userId: "a", workers: 10, workerAvg: 10 },
    { userId: "b", workers: 10, workerAvg: 10 },
  ]), null);
  // Ortalama tabanın altındaysa sahiplik yok: iki işçiyle bölge sahibi olunmaz.
  assert.equal(dominantMiner([
    { userId: "a", workers: 3, workerAvg: INFLUENCE_MIN_AVG_WORKERS - 1 },
    { userId: "b", workers: 1, workerAvg: 0 },
  ]), null);
});

test("işçisini çeken sahiplik alamaz: gıyabında kira toplanmaz", () => {
  // İSTİSMAR: ortalaması yüksek olan krallık işçilerini çekip pencerenin
  // kalanında bedavaya pay toplayabilirdi.
  assert.equal(dominantMiner([
    { userId: "a", workers: 0, workerAvg: settledAvg(30) },
    { userId: "b", workers: 10, workerAvg: settledAvg(10) },
  ]), null);
});

test("sıra girdi sırasına bağlı değildir", () => {
  const rows = [
    { userId: "z", workers: 20, workerAvg: 20 },
    { userId: "a", workers: 5, workerAvg: 5 },
  ];
  assert.equal(dominantMiner(rows), dominantMiner([...rows].reverse()));
});

// --- payın kendisi ----------------------------------------------------------

/** Route'un yaptığı işin saf taklidi: satırları ve sahipliği taşıyarak ilerler. */
function run(rows: MineCrew[], options: { from: number; to: number; steps: number; oreRemaining: number; influence?: MineInfluence | null; speed?: number }) {
  const speed = options.speed ?? 1;
  let crewRows = rows.map(row => ({ ...row }));
  let influence = options.influence ?? null;
  let delivered = 0, extracted = 0, ore = options.oreRemaining;
  /** Krallık başına teslim edilen toplam: pay ölçümü kişi kişi yapılabilsin. */
  const perUserDelivered = new Map<string, number>(rows.map(row => [row.userId, 0]));
  const stepMs = (options.to - options.from) / options.steps;
  for (let step = 1; step <= options.steps; step += 1) {
    const at = options.from + stepMs * step;
    const settlement = settleMine(crewRows, { speed, hours: stepMs / 3_600_000, oreRemaining: ore, now: at, influence });
    influence = settlement.influence;
    ore -= settlement.extracted;
    extracted += settlement.extracted;
    delivered += settlement.extracted;
    for (const share of settlement.shares) perUserDelivered.set(share.userId, (perUserDelivered.get(share.userId) ?? 0) + share.delivered);
    crewRows = settlement.shares.map(share => ({
      userId: share.userId, workers: share.workers, pendingOre: share.pendingOre,
      lastDeliveryAt: share.delivered > 0 ? at : share.lastDeliveryAt, workerAvg: share.workerAvg,
    }));
  }
  const byUser = new Map(crewRows.map(row => [row.userId, row]));
  return { crewRows, byUser, influence, delivered, extracted, ore, perUserDelivered };
}

test("bölge sahibi ötekilerin AKTİF üretiminden pay alır", () => {
  const rows = [
    crew({ userId: "a", workers: 20, workerAvg: settledAvg(20), lastDeliveryAt: 0 }),
    crew({ userId: "b", workers: 5, workerAvg: settledAvg(5), lastDeliveryAt: 0 }),
  ];
  const settled = settleMine(rows, {
    speed: 1, hours: 1, oreRemaining: 100_000, now: BOUNDARY,
    influence: { userId: "a", window: influenceWindowAt(BOUNDARY - 3_600_000, 1) },
  });
  assert.equal(settled.influence.userId, "a");
  const own = settled.shares.find(share => share.userId === "a")!;
  const other = settled.shares.find(share => share.userId === "b")!;
  const bareOwn = 20 * ORE_PER_WORKER_HOUR, bareOther = 5 * ORE_PER_WORKER_HOUR;
  // b üretiminin %10'unu kaybeder, a onu kazanır.
  assert.equal(other.delivered + other.pendingOre, bareOther * (1 - INFLUENCE_CUT));
  assert.equal(Math.round((own.delivered + own.pendingOre) * 1e6) / 1e6, bareOwn + bareOther * INFLUENCE_CUT);
});

test("nüfuz CEVHER ÜRETMEZ: damardan çıkan toplam değişmez", () => {
  // En kritik istismar freni. Pay bir dağıtım kuralıdır; damara ya da ambara
  // yeni cevher eklemez.
  const rows = () => [
    crew({ userId: "a", workers: 20, workerAvg: settledAvg(20) }),
    crew({ userId: "b", workers: 8, workerAvg: settledAvg(8) }),
    crew({ userId: "c", workers: 6, workerAvg: settledAvg(6) }),
  ];
  const withOwner = settleMine(rows(), {
    speed: 1, hours: 2, oreRemaining: 100_000, now: BOUNDARY,
    influence: { userId: "a", window: influenceWindowAt(BOUNDARY - 7_200_000, 1) },
  });
  const without = settleMine(rows(), {
    speed: 1, hours: 2, oreRemaining: 100_000, now: BOUNDARY,
    influence: { userId: null, window: influenceWindowAt(BOUNDARY - 7_200_000, 1) },
  });
  const total = (settlement: typeof withOwner) =>
    settlement.shares.reduce((sum, share) => sum + share.delivered + share.pendingOre, 0);
  assert.ok(Math.abs(total(withOwner) - total(without)) < 1e-6, "toplam cevher değişti");
  // `extracted` (o hesapta TESLİM EDİLEN tam sayı) bir cevher oynayabilir:
  // pay kesirli paylar ürettiği için yuvarlama farklı düşer, kalan küsurat
  // `pendingOre` içinde bekler ve kaybolmaz. Ölçüt bu yüzden toplamdır.
  assert.ok(Math.abs(withOwner.extracted - without.extracted) <= 1, "teslimat bir cevherden fazla saptı");
});

test("damarda kalandan fazlası çıkarılamaz; sahiplik bunu değiştirmez", () => {
  const settled = settleMine([
    crew({ userId: "a", workers: 20, workerAvg: settledAvg(20) }),
    crew({ userId: "b", workers: 20, workerAvg: 1 }),
  ], {
    speed: 1, hours: 5, oreRemaining: 40, now: BOUNDARY,
    influence: { userId: "a", window: influenceWindowAt(BOUNDARY - 5 * 3_600_000, 1) },
  });
  const total = settled.shares.reduce((sum, share) => sum + share.delivered + share.pendingOre, 0);
  assert.ok(total <= 40 + 1e-9, `damardan fazlası dağıtıldı: ${total}`);
});

test("sahip yoksa hesap eski davranışla birebir aynıdır", () => {
  const rows = [
    crew({ userId: "a", workers: 7, workerAvg: 0 }),
    crew({ userId: "b", workers: 3, workerAvg: 0 }),
  ];
  const settled = settleMine(rows, { speed: 1, hours: 1, oreRemaining: 100_000, now: BOUNDARY });
  assert.equal(settled.influence.userId, null, "ortalaması olmayan ekipte sahip çıkmamalı");
  assert.equal(settled.shares.find(share => share.userId === "a")!.delivered, 7 * ORE_PER_WORKER_HOUR);
  assert.equal(settled.shares.find(share => share.userId === "b")!.delivered, 3 * ORE_PER_WORKER_HOUR);
});

// --- pencere kilidi ---------------------------------------------------------

test("sahiplik pencere içinde değişmez; yeni gelen anında bölge sahibi olamaz", () => {
  // Karar: "en çok işçi ölçütü bir süre boyunca sabit tutulur" — anlık
  // sahiplik kapma yarışını önler.
  const inside = BOUNDARY + WINDOW_MS / 2;
  const settled = settleMine([
    crew({ userId: "a", workers: 6, workerAvg: settledAvg(6) }),
    crew({ userId: "yeni", workers: 60, workerAvg: 0 }),
  ], {
    speed: 1, hours: 1, oreRemaining: 100_000, now: inside,
    influence: { userId: "a", window: influenceWindowAt(inside, 1) },
  });
  assert.equal(settled.influence.userId, "a", "pencere içinde sahiplik el değiştirdi");
});

test("pencere sınırında sahiplik yeniden tartılır", () => {
  const rows = [
    crew({ userId: "a", workers: 6, workerAvg: settledAvg(6) }),
    crew({ userId: "b", workers: 40, workerAvg: settledAvg(40) }),
  ];
  const settled = settleMine(rows, {
    speed: 1, hours: 1, oreRemaining: 100_000, now: BOUNDARY + 3_600_000,
    // Önceki pencerede sahip "a"ydı; yeni pencerede ortalaması açık ara önde
    // olan "b" devralır.
    influence: { userId: "a", window: influenceWindowAt(BOUNDARY - 1, 1) },
  });
  assert.equal(settled.influence.userId, "b");
});

// --- kısıt #2: adım-bölünmesi bağımsızlığı ----------------------------------

test("madenin payı adım-bölünmesinden bağımsızdır (pencere sınırını aşan hesap)", () => {
  // Hesap pencere SINIRINI aşıyor: tek büyük adım ile küçük adımlar aynı
  // sahibi bulmak ve aynı cevheri dağıtmak zorunda. Bu, kısıt #2'nin bu
  // maddedeki karşılığı — sahiplik eşiği süreklilik taşımayan bir karar
  // olduğu için pencereye kilitlenmesinin gerekçesi de budur.
  const from = BOUNDARY - 2 * 3_600_000, to = BOUNDARY + 2 * 3_600_000;
  const rows = () => [
    crew({ userId: "a", workers: 25, workerAvg: settledAvg(25) }),
    crew({ userId: "b", workers: 9, workerAvg: settledAvg(9) }),
    crew({ userId: "c", workers: 4, workerAvg: 0 }),
  ];
  const start: MineInfluence = { userId: null, window: influenceWindowAt(from, 1) };
  const single = run(rows(), { from, to, steps: 1, oreRemaining: 100_000, influence: start });
  const many = run(rows(), { from, to, steps: 48, oreRemaining: 100_000, influence: start });

  assert.equal(single.influence?.userId, many.influence?.userId, "sahip adım sayısına göre değişti");
  assert.equal(single.influence?.window, many.influence?.window);
  // Ortalama (sahipliğin ölçütü) iki yolda da aynı: kapalı çözümün karşılığı.
  for (const userId of ["a", "b", "c"]) {
    const one = single.byUser.get(userId)!, split = many.byUser.get(userId)!;
    assert.ok(Math.abs((one.workerAvg ?? 0) - (split.workerAvg ?? 0)) < 1e-6, `${userId} ortalaması saptı: ${one.workerAvg} vs ${split.workerAvg}`);
  }
  /**
   * ÖLÇÜT: teslim edilen + bekleyen. `delivered`ın kendisi adım sayısına
   * BAĞLIDIR ve bu maddeden ÖNCE de öyleydi — teslimat 10 dakikada bir
   * yapıldığı için son diliminki `pendingOre`'da bekler. Kaybolan/uydurulan
   * cevher olmadığının ölçütü toplam, ve krallık başına da tutuluyor.
   */
  const sum = (value: ReturnType<typeof run>) =>
    value.delivered + value.crewRows.reduce((total, row) => total + row.pendingOre, 0);
  assert.ok(Math.abs(sum(single) - sum(many)) < 1e-6, `toplam cevher saptı: ${sum(single)} vs ${sum(many)}`);
  // Damarın gerçek bakiyesi: kalan − rezerve edilmiş (bekleyen) paylar. Bu
  // hesap `settleMine`'ın kendi `budget` tanımıyla aynı ve adım sayısından
  // bağımsız olmak zorunda.
  const budget = (value: ReturnType<typeof run>) =>
    value.ore - value.crewRows.reduce((total, row) => total + row.pendingOre, 0);
  assert.ok(Math.abs(budget(single) - budget(many)) < 1e-6, `damarın bakiyesi saptı: ${budget(single)} vs ${budget(many)}`);
});

test("sahiplik EL DEĞİŞTİRİRKEN de adım-bölünmesinden bağımsız kalır", () => {
  /**
   * BU TESTİN ASIL DERDİ pencere kilidi. Sahiplik "o anki ortalamaya" göre
   * seçilseydi, hesabın kaç parçaya bölündüğü sahibin KAÇTA KAÇINDA
   * değiştiğini belirlerdi: 5 dakikalık adımlarla yürüyen bir sunucu, tek
   * adımda yürüyen bir sunucudan farklı bir cevher dağıtımı üretirdi. Kilit
   * bu yüzden var — sahiplik mutlak zamana oturan pencerelerin başında bir
   * kez tartılır.
   *
   * Senaryo el değiştirmeyi GERÇEKTEN tetikler: hızlı bir channel'da (×24)
   * "b" işçi sayısını yüksek tutar, ortalaması "a"nın önüne geçer ve sahiplik
   * hesabın ortasında devreder.
   */
  const speed = 24;
  const windowMs = influenceWindowMs(speed);
  const boundary = windowMs * 1_000_003;
  const from = boundary, to = boundary + 2 * 3_600_000;
  const rows = () => [
    crew({ userId: "a", workers: 10, workerAvg: settledAvg(10) }),
    crew({ userId: "b", workers: 40, workerAvg: 0 }),
  ];
  const start: MineInfluence = { userId: "a", window: influenceWindowAt(from, speed) };
  const single = run(rows(), { from, to, steps: 1, oreRemaining: 500_000, influence: start, speed });
  const many = run(rows(), { from, to, steps: 24, oreRemaining: 500_000, influence: start, speed });

  assert.equal(single.influence?.userId, "b", "senaryo el değiştirmeyi tetiklemiyor; test anlamsız kalır");
  assert.equal(many.influence?.userId, "b");
  const share = (value: ReturnType<typeof run>, userId: string) => {
    const row = value.byUser.get(userId)!;
    return value.perUserDelivered.get(userId)! + row.pendingOre;
  };
  for (const userId of ["a", "b"]) {
    assert.ok(
      Math.abs(share(single, userId) - share(many, userId)) < 1e-6,
      `${userId} payı adım sayısına bağlandı: ${share(single, userId)} vs ${share(many, userId)}`,
    );
  }
});
