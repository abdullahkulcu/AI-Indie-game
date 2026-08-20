import { z } from "zod";
import { FESTIVAL, LOYALTY_STEP, MAX_ACTIONS_PER_TURN, marketDuration } from "../engine/actions";
import { BUILDABLE_TYPES, MAX_BUILDING_LEVEL } from "../engine/catalog";
import { PROTECTION_DAYS, STARTING_BUILDINGS, STARTING_POPULATION, STARTING_REPUTATION, startingResources } from "../engine/founding";
import { orderCost, orderGoldBounds, orderPayout } from "../engine/market";
import { POLICY_LIMITS, clampPolicy } from "../engine/policy";
import { RATION_LIMITS, clampRation } from "../engine/populace";
import { WATCH_LIMITS, clampWatch, resolveRaids } from "../engine/raids";
import { capacityFor, tick } from "../engine/tick";
import type { Game, Key } from "../engine/types";

/**
 * Oyun durumu hâlâ istemcide hesaplanıyor (bkz. components/KingdomGame.tsx).
 * Bu modül sunucunun kabul ettiği yüzeyi daraltır: yapıyı, üst sınırları ve
 * iki kayıt arasındaki makul değişim hızını doğrular. Tam sunucu-yetkili tick
 * gelene kadar geçerli savunma katmanı budur; uydurma değerleri tamamen
 * engellemez ama "bir milyar altın" sınıfı hileleri keser.
 */

/**
 * Kabul edilen bina türleri. KATALOGDAN TÜRETİLİR.
 *
 * Elle yazıldığında kataloğdan saptı ve sonucu ağırdı: listede olmayan bir bina
 * kuran oyuncunun kaydı sunucuda TAMAMEN reddediliyordu. Kral Ambar kurdu,
 * kaydı reddedildi, istemci sunucudaki eski kopyayı aldı ve bina "kaybolmuş"
 * göründü. Depo'nun seviye atlaması da aynı sebeple hiç kalıcı olmadı.
 */
export const BUILDING_TYPES: readonly string[] = BUILDABLE_TYPES;

export const RESOURCE_KEYS = ["gold", "food", "stone", "wood", "iron", "ale"] as const;

/** Yerel pazarda işlem gören kaynaklar; halkın defteri yalnızca bunları tutar. */
export const TRADED_RESOURCE_KEYS = ["food", "wood", "stone", "iron", "ale"] as const;

export const TERRAIN_IDS = ["plain", "forest", "mountain", "riverbank"] as const;

export const CHANNEL_SPEEDS = [1, 4, 24] as const;

/** Hiçbir meşru oyuncunun ulaşamayacağı, ama tip taşmasını da engelleyen tavanlar. */
export const CAPS = {
  resource: 5_000_000,
  population: 200_000,
  capacity: 200_000,
  // Motorun tavanından TÜRETİLİR. İkisi ayrı yazıldığında motor Sv.7 öneriyor,
  // şema Sv.7'yi reddediyor ve kaydın tamamı 400 alıyordu.
  buildingLevel: MAX_BUILDING_LEVEL,
  buildings: 40,
  unitCount: 100_000,
  unitKinds: 24,
  notices: 80,
  quota: 24,
  // Motorun kendi sınırından TÜRETİLİR (engine/policy.ts): şema, motorun
  // reddettiği bir vergiyi kabul etmesin ve iki sayı ayrı ayrı sapmasın.
  taxRate: POLICY_LIMITS.taxRate.max,
  ration: RATION_LIMITS.max,
  watchRatio: WATCH_LIMITS.max,
} as const;

/**
 * Kuruluş anındaki kanonik başlangıç. İlk buluta kayıtta bunun üstüne çıkılamaz.
 *
 * Artık HIZA BAĞLI bir fonksiyon: başlangıç malzemesi channel hızıyla
 * ölçeklendiği için sabit bir tavan hız 24'ü tamamen oynanamaz hâle getirirdi
 * (7.200 odun > 300 + 5.000 → her yeni krallığın ilk kaydı 409). Değerler
 * `engine/founding.ts`'ten gelir; burada ikinci bir kopya tutulmaz.
 */
export function startingState(speed: number) {
  return {
    resources: startingResources(speed),
    population: STARTING_POPULATION,
    buildings: STARTING_BUILDINGS.length,
    protectionDays: PROTECTION_DAYS,
  };
}

/** Saatlik makul kazanç tavanları; channel hızıyla çarpılır. Sıçramalar için ayrıca pay verilir. */
const GROWTH = {
  resourcePerHour: 20_000,
  resourceBurst: 50_000,
  populationPerHour: 500,
  populationBurst: 200,
  buildingLevelsPerHour: 6,
  buildingLevelsBurst: 4,
  unitsPerHour: 200,
  unitsBurst: 100,
  /**
   * Sadakatin saatlik tavanı. Sadakat yalnızca uygulanan emirlerle yükselir
   * (bkz. engine/actions.ts, LOYALTY_STEP) ve emirler General turlarından
   * gelir; tur sayısı `RATE_LIMITS.general` ile saatte 40'la sınırlıdır:
   * 40 tur × MAX_ACTIONS_PER_TURN emir × .5 puan = saatte 60 puan.
   */
  loyaltyPerHour: 60,
} as const;

/**
 * SIÇRAMA PAYI ARTIK İSTEK BAŞINA DEĞİL, PENCEREYE BAĞLI.
 *
 * Eski kural geçen süreyi bir dakikaya YUVARLIYORDU: iki kayıt arasında 5
 * saniye geçse bile pay tam ödeniyordu (hız 1'de 50.333, hız 24'te 58.000
 * altın — KAYIT BAŞINA). İstemci 5 saniyede bir kaydediyor ama bu kısıt
 * tamamen istemcideydi; saniyede 10 kayıt atan bir betik saniyede yarım
 * milyon altın basıyor ve iki denetim de "geçti" diyordu.
 *
 * Yeni kural: pay, geçen süreyle ORANTILI olarak birikir ve BURST_WINDOW_MS
 * dolduğunda tamamlanır. İzin böylece tamamen süreye bağlı bir doğru olur;
 * aynı süreyi kaç isteğe böldüğünüz toplam izni DEĞİŞTİRMEZ. 12 kayıt × 5
 * saniye, 1 kayıt × 60 saniye ile aynı payı verir.
 *
 * Taban yine de sıfır değil: `previousUpdatedAt` veritabanı saatinden,
 * `now` uygulama saatinden gelir. İkisi arasındaki küçük kayma pencereyi
 * negatife düşürüp meşru kaydı reddetmesin diye istemcinin kendi kayıt
 * aralığı (5 sn) taban kabul edilir.
 */
const GROWTH_MIN_WINDOW_MS = 5_000;
const BURST_WINDOW_MS = 60_000;

/** İstemci saatinin sunucudan ileri olmasına verilen tolerans. */
const CLOCK_SKEW_MS = 5 * 60_000;

/**
 * İstemci tick'i saniyelik küçük adımlarla ilerlerken sunucu tek adımda hesaplar;
 * bina tamamlanması ve nüfus büyümesi araya girdiği için küçük bir sapma normaldir.
 */
const SIMULATION_TOLERANCE = 0.08;
const SIMULATION_FLOOR = 250;

const finite = (max: number, min = 0) => z.number().finite().min(min).max(max);
const timestamp = z.number().finite().int().min(0).max(4_102_444_800_000); // 2100-01-01

const resourcesSchema = z.object(
  Object.fromEntries(RESOURCE_KEYS.map(key => [key, finite(CAPS.resource)])) as Record<
    (typeof RESOURCE_KEYS)[number],
    z.ZodNumber
  >,
).strict();

const buildingSchema = z.object({
  // z.enum sabit bir demet ister; katalogdan türetilen liste için refine kullanılır.
  type: z.string().min(1).max(40).refine(value => BUILDING_TYPES.includes(value), {
    message: "Bilinmeyen bina türü.",
  }),
  name: z.string().min(1).max(60),
  category: z.string().min(1).max(40),
  level: z.number().int().min(1).max(CAPS.buildingLevel),
}).strict();

const queueSchema = z.object({
  kind: z.enum(["building", "unit"]),
  type: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  targetLevel: z.number().int().min(1).max(CAPS.buildingLevel).optional(),
  count: z.number().int().min(1).max(CAPS.unitCount).optional(),
  startedAt: timestamp.optional(),
  completesAt: timestamp,
  hastened: z.boolean().optional(),
}).strict();

const noticeSchema = z.object({
  kind: z.string().min(1).max(40),
  text: z.string().min(1).max(400),
  at: timestamp,
}).strict();

export const gameSaveSchema = z.object({
  version: z.literal(2),
  kingdomName: z.string().trim().min(1).max(36),
  rulerName: z.string().trim().min(1).max(30),
  channel: z.string().min(1).max(60),
  channelId: z.string().max(64).optional(),
  speed: z.union([z.literal(1), z.literal(4), z.literal(24)]),
  terrain: z.enum(TERRAIN_IDS),
  foundedAt: timestamp,
  lastTickAt: timestamp,
  protectionEndsAt: timestamp,
  resources: resourcesSchema,
  population: finite(CAPS.population),
  capacity: finite(CAPS.capacity),
  popularity: finite(100),
  reputation: finite(100),
  loyalty: finite(100),
  taxRate: finite(CAPS.taxRate),
  // Emir kotası kaldırıldı. Alanlar `.optional()`: eski kayıtlar (alan dolu) ve
  // arayüz kotayı bıraktıktan sonraki kayıtlar (alan yok) birlikte kabul edilir.
  // Değer artık hiçbir kuralı beslemediği için üst sınır dışında denetlenmez.
  quota: finite(CAPS.quota).optional(),
  quotaAt: timestamp.optional(),
  buildings: z.array(buildingSchema).min(1).max(CAPS.buildings),
  units: z.record(z.string().regex(/^[a-z_]{2,24}$/), finite(CAPS.unitCount)).refine(
    value => Object.keys(value).length <= CAPS.unitKinds,
    { message: "Birlik türü sayısı sınırı aşıldı." },
  ),
  queue: queueSchema.nullable(),
  notices: z.array(noticeSchema).max(CAPS.notices),
  provider: z.string().max(40).nullable(),
  model: z.string().max(80).nullable(),
  generalConnected: z.boolean(),
  strategyNote: z.string().max(300).optional(),
  startingReserveGranted: z.boolean().optional(),
  // Halk sistemi. Eski kayıtlarda yok; motor varsayılan uygular.
  // Üst sınırlar motorun kendi sınırlarından TÜRETİLİR (engine/populace.ts).
  foodRation: finite(CAPS.ration).optional(),
  aleRation: finite(CAPS.ration).optional(),
  soldierPay: finite(CAPS.ration).optional(),
  soldierUnrest: finite(100).optional(),
  mineWorkers: finite(CAPS.population).optional(),
  peopleJoined: finite(1e9).optional(),
  peopleLeft: finite(1e9).optional(),
  migrationDrift: z.number().finite().optional(),
  lastSettlerCallAt: z.number().finite().optional(),
  marketVolume: finite(1e7).optional(),
  /**
   * Açık pazar teklifleri. `gold` alanı BURADA yalnızca tip taşmasına karşı
   * kısıtlıdır; asıl denetim `checkMarketOrders` içindedir — şemada dar bir
   * sınır, eski kayıtlardaki meşru teklifleri de reddederdi.
   */
  marketOrders: z.array(z.object({
    id: z.string().min(1).max(80),
    resource: z.enum(["gold", "food", "stone", "wood", "iron", "ale"]),
    amount: z.number().int().min(1).max(1e6),
    direction: z.enum(["sell", "buy"]),
    gold: finite(1e7),
    placedAt: timestamp,
    completesAt: timestamp,
  }).strict()).max(6).optional(),
  marketDayAt: z.number().finite().optional(),
  /**
   * Halkın kendi stoğu — yerel pazarın fiyatı buradan doğar. Eski kayıtlarda
   * yoktur; motor o zaman halkı normal stoğunda kabul eder, yani fiyat taban
   * fiyattır ve kimsenin kaydı bu alan yüzünden reddedilmez.
   *
   * Şişirilmesi kaynak yaratmaz, yalnızca fiyatı oynatır ve fiyatın kendisi
   * taban/tavan arasına kilitlidir (bkz. engine/market.ts). Elde edilecek
   * altın ayrıca `checkAgainstSimulation` ve `checkGrowth` ile sınırlıdır.
   */
  commons: z.object(
    Object.fromEntries(TRADED_RESOURCE_KEYS.map(key => [key, finite(CAPS.resource)])) as Record<
      (typeof TRADED_RESOURCE_KEYS)[number],
      z.ZodNumber
    >,
  ).strict().optional(),
  lastSpoilNoticeAt: z.number().finite().optional(),
  // Akın ve nöbet sistemi. Eski kayıtlarda yok; motor varsayılan uygular.
  watchRatio: finite(CAPS.watchRatio).optional(),
  lastRaidAt: timestamp.optional(),
  raidsRepelled: finite(1_000_000).optional(),
  raidsSuffered: finite(1_000_000).optional(),
}).strict();

export type GameSave = z.infer<typeof gameSaveSchema>;

export type ValidationFailure = { ok: false; status: 400 | 409; error: string };
export type ValidationSuccess = { ok: true; game: GameSave };
export type ValidationOutcome = ValidationSuccess | ValidationFailure;

const fail = (status: 400 | 409, error: string): ValidationFailure => ({ ok: false, status, error });

const totalUnits = (units: Record<string, number>) =>
  Object.values(units).reduce((sum, value) => sum + value, 0);

const totalLevels = (buildings: Array<{ level: number }>) =>
  buildings.reduce((sum, building) => sum + building.level, 0);

/** Depolanan bir kaydın hâlâ okunabilir olup olmadığını söyler; bozuk kayıt istemciyi kilitlemesin diye. */
export function parseStoredSave(gameState: string): GameSave | null {
  try {
    const parsed = gameSaveSchema.safeParse(JSON.parse(gameState));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** İstemcinin ilettiği zaman damgalarının geleceğe veya koruma süresinin ötesine kaçmadığını doğrular. */
function checkTimestamps(game: GameSave, now: number): ValidationFailure | null {
  const horizon = now + CLOCK_SKEW_MS;
  if (game.foundedAt > horizon) return fail(400, "Kuruluş zamanı gelecekte olamaz.");
  if (game.lastTickAt > horizon) return fail(400, "Kayıt zamanı gelecekte olamaz.");
  if (game.quotaAt !== undefined && game.quotaAt > horizon) return fail(400, "Emir kotası zamanı gelecekte olamaz.");
  const maxProtection = game.foundedAt + PROTECTION_DAYS * 86_400_000 + CLOCK_SKEW_MS;
  if (game.protectionEndsAt > maxProtection) return fail(400, "Koruma süresi izin verilen sınırı aşıyor.");
  return null;
}

/**
 * İlk buluta kayıt kanonik başlangıcın belirgin biçimde ötesinde olamaz.
 *
 * Tavan channel hızıyla ölçeklenmek ZORUNDA: başlangıç odunu hız 24'te 7.200
 * olduğu için sabit tavan her yeni krallığın ilk kaydını 409 ile reddederdi.
 *
 * Ölçek, channel hızı ile kaydın kendi hızının BÜYÜĞÜdür. Sebebi bir yarış:
 * istemci `found()` sırasında channel üyeliğini yazan isteği beklemiyor, ilk
 * PUT üyelik satırından önce gelebiliyor ve o an `options.channelSpeed`
 * varsayılan 1 oluyor. Yalnızca channel hızına bakılsaydı hız 24 channel'ında
 * kurulan krallığın ilk kaydı bu yarış yüzünden reddedilirdi.
 */
function checkFirstSave(game: GameSave, channelSpeed: number): ValidationFailure | null {
  const starting = startingState(Math.max(1, channelSpeed, game.speed));
  for (const key of RESOURCE_KEYS) {
    if (game.resources[key] > starting.resources[key] + 5_000) {
      return fail(409, "İlk kayıt başlangıç kaynaklarının ötesinde olamaz.");
    }
  }
  if (game.population > starting.population * 2) return fail(409, "İlk kayıt başlangıç nüfusunu aşamaz.");
  if (game.buildings.length > starting.buildings + 3) return fail(409, "İlk kayıt başlangıç yapılarını aşamaz.");
  if (game.buildings.some(building => building.level > 2)) return fail(409, "İlk kayıtta yapı seviyesi 2'yi aşamaz.");
  if (totalUnits(game.units) > 50) return fail(409, "İlk kayıtta ordu mevcudu geçersiz.");
  // Yeni krallıkta Pazar yoktur (Kale Sv.2 ister); ilk kayıtta duran bir teklif
  // ancak uydurmadır ve karşılaştıracak önceki kayıt olmadığı için ölçülemez.
  if (ordersOf(game).length > 0) return fail(409, "İlk kayıtta açık pazar teklifi olamaz.");
  return null;
}

type StoredOrder = NonNullable<GameSave["marketOrders"]>[number];

const ordersOf = (save: GameSave): readonly StoredOrder[] => save.marketOrders ?? [];

/** İki kayıt arasında YENİ açılmış teklifler; eskiden duranlar bir kez ölçüldü. */
function freshOrders(game: GameSave, previous: GameSave): StoredOrder[] {
  const known = new Set(ordersOf(previous).map(order => order.id));
  return ordersOf(game).filter(order => !known.has(order.id));
}

/** Bir defter hareketi toplamı: {kaynak → miktar}. */
function tally(entries: Array<{ key: Key; amount: number }>): Partial<Record<Key, number>> {
  const total: Partial<Record<Key, number>> = {};
  for (const entry of entries) total[entry.key] = (total[entry.key] ?? 0) + entry.amount;
  return total;
}

/**
 * PAZAR TEKLİFLERİ — "kaynak yaratan tek yol tick üretimidir" varsayımının
 * yeniden doğru olduğu yer.
 *
 * Teklifin altını istemcide hesaplanıp kayda yazılıyor ve `tick()` teklif
 * kapanınca o sayıyı sorgusuz hazineye ekliyor (bkz. engine/tick.ts). Sunucu
 * bunu şöyle kapatır:
 *
 *  1. Her teklifin bedeli fiyat modelinin KENDİ tavan/tabanına vurulur
 *     (`orderGoldBounds`). Sınır emrin ne zaman verildiğinden bağımsız
 *     olduğu için hâlihazırda açık duran meşru teklifler de geçer.
 *  2. Bekleyen bir teklif SONRADAN DEĞİŞTİRİLEMEZ: bir kez ölçülen teklifin
 *     altını, miktarı ya da kapanma anı ikinci kayıtta oynatılamaz.
 *  3. Yeni teklifin veriliş anı bu kayıt aralığının içinde olmalı ve motorun
 *     verdiği süreden (`marketDuration`) önce kapanamaz — "anında kapanan"
 *     teklifle ödeme öne çekilemesin.
 *
 * Teklifin peşinatının gerçekten ödendiği ise `checkAgainstSimulation` içinde
 * doğrulanır: ödemesiz teklif, kaynak tavanını kendi bedeli kadar düşürür.
 */
function checkMarketOrders(game: GameSave, previous: GameSave, now: number): ValidationFailure | null {
  const kept = new Map(ordersOf(previous).map(order => [order.id, order]));
  const seen = new Set<string>();
  for (const order of ordersOf(game)) {
    if (seen.has(order.id)) return fail(409, "Aynı pazar teklifi kayıtta iki kez duramaz.");
    seen.add(order.id);
    if (order.resource === "gold") return fail(409, "Altın pazarda mal değildir; böyle bir teklif verilemez.");

    const bounds = orderGoldBounds(order.resource, order.amount, order.direction);
    // Yalnızca istemcinin İŞİNE YARAYAN yön kapatılır: satışta fazla alacak,
    // alışta eksik ödeme. Ters yön oyuncunun kendi zararıdır ve yuvarlama
    // (satışta floor, alışta ceil) da hep bu güvenli yöne çalışır.
    if (order.direction === "sell" && order.gold > bounds.max) {
      return fail(409, "Pazar satışının getirisi fiyat modelinin tavanını aşıyor.");
    }
    if (order.direction === "buy" && order.gold < bounds.min) {
      return fail(409, "Pazar alımının bedeli fiyat modelinin tabanının altında.");
    }

    const before = kept.get(order.id);
    if (before) {
      if (before.resource !== order.resource || before.direction !== order.direction
        || before.amount !== order.amount || before.gold !== order.gold
        || before.placedAt !== order.placedAt || before.completesAt !== order.completesAt) {
        return fail(409, "Bekleyen pazar teklifi sonradan değiştirilemez.");
      }
      continue;
    }
    if (order.placedAt < previous.lastTickAt - CLOCK_SKEW_MS || order.placedAt > now + CLOCK_SKEW_MS) {
      return fail(409, "Pazar teklifinin veriliş zamanı bu kayıt aralığının dışında.");
    }
    if (order.completesAt < order.placedAt + marketDuration(order.amount, game.speed) * 60_000) {
      return fail(409, "Pazar teklifi motorun verdiği süreden erken kapanamaz.");
    }
  }
  return null;
}

/**
 * Sunucu, önceki kayıttan bu ana kadarki üretimi aynı motorla kendisi simüle eder.
 *
 * Oyunda kaynak yaratan tek yol tick üretimidir: bütün emirler kaynak *harcar*,
 * ortak maden ise oyuncunun kaydına cevher yazmaz. Dolayısıyla istemcinin bildirdiği
 * kaynak, sunucunun kendi simülasyonunun üstüne çıkamaz. Bu, genel tavanlardan çok
 * daha dar bir sınırdır ve uydurma kaynağı gerçek üretim eğrisiyle yakalar.
 *
 * Akınlar bu varsayımı bozmaz çünkü kaynak ÇALARLAR, üretmezler. Yine de yağmayı
 * tavandan düşmüyoruz: istemci iki kayıt arasında nöbeti yükseltip akını
 * püskürtmüş olabilir ve o zaman elinde sunucunun simüle ettiğinden çok kaynak
 * kalır. Bu meşru bir sonuçtur, hile değildir; tavanı yağmasız üretim eğrisine
 * göre kurarız, böylece sınır yine üretimle çizilir.
 */
function checkAgainstSimulation(game: GameSave, previous: GameSave, simulated: Game, horizon: number): ValidationFailure | null {
  const looted = resolveRaids(previous as Game, previous.lastTickAt, horizon, previous.resources);
  const loot: Partial<Record<(typeof RESOURCE_KEYS)[number], number>> = { food: looted.foodStolen, gold: looted.goldStolen };
  // Bu pencerede açılan teklifin peşinatı tavandan DÜŞÜLÜR. Sunucunun
  // simülasyonu o tekliften habersizdir (teklif `previous`'ta yoktu), yani
  // ödemesi yapılmamış uydurma bir teklif tavanı olduğu gibi bırakırdı ve
  // hiç sahip olunmayan 1.000.000 demir "satılıp" hazineye altın yazılırdı.
  const spent = tally(freshOrders(game, previous).map(orderCost));
  for (const key of RESOURCE_KEYS) {
    const produced = Math.max(0, simulated.resources[key] + (loot[key] ?? 0) - (spent[key] ?? 0));
    const ceiling = produced * (1 + SIMULATION_TOLERANCE) + SIMULATION_FLOOR;
    if (game.resources[key] > ceiling) {
      return fail(409, `Bildirilen ${key} miktarı sunucunun ürettiği değerin üzerinde.`);
    }
  }
  if (game.population > simulated.population * (1 + SIMULATION_TOLERANCE) + 5) {
    return fail(409, "Bildirilen nüfus sunucunun hesapladığı büyümenin üzerinde.");
  }
  // Emir kotası denetimi kaldırıldı: kota artık hiçbir emri kısıtlamadığı için
  // şişirilmesi de bir avantaj sağlamıyor. Motor kotayı biriktirmediğinden bu
  // kontrol, istemcinin taşıdığı eski değeri haksız yere reddediyordu.
  return null;
}

/** İki kayıt arasındaki artışın, geçen süre ve channel hızıyla açıklanabilir olduğunu doğrular. */
function checkGrowth(game: GameSave, previous: GameSave, elapsedMs: number, channelSpeed: number): ValidationFailure | null {
  // Sunucu saatine göre geçen süre. Sıçrama payı da SÜREYE bağlıdır: aynı
  // süreyi kaç isteğe bölerseniz bölün toplam izin değişmez (bkz. yukarıda).
  const span = Math.max(elapsedMs, GROWTH_MIN_WINDOW_MS);
  const hours = span / 3_600_000, speed = Math.max(1, channelSpeed);
  const burstShare = Math.min(1, span / BURST_WINDOW_MS);
  const allow = (perHour: number, burst: number) => perHour * hours * speed + burst * burstShare;
  // Bekleyen teklifin getireceği yük bu doğrunun dışındadır: bedeli verildiği
  // anda ölçüldü (checkMarketOrders) ve kapanışı tek kalemde düşer. Payı
  // pencereye bağlarken bunu tanımasaydık, Sv.5 Pazarın kapanan teklifi
  // meşru oyuncunun kaydını 409'lardı.
  const owed = tally(ordersOf(previous).map(orderPayout));

  for (const key of RESOURCE_KEYS) {
    const gain = game.resources[key] - previous.resources[key];
    if (gain > allow(GROWTH.resourcePerHour, GROWTH.resourceBurst) + (owed[key] ?? 0)) {
      return fail(409, `Kaynak artışı (${key}) geçen sürede mümkün değil.`);
    }
  }
  if (game.population - previous.population > allow(GROWTH.populationPerHour, GROWTH.populationBurst)) {
    return fail(409, "Nüfus artışı geçen sürede mümkün değil.");
  }
  if (totalLevels(game.buildings) - totalLevels(previous.buildings) > allow(GROWTH.buildingLevelsPerHour, GROWTH.buildingLevelsBurst)) {
    return fail(409, "Yapı seviyesi artışı geçen sürede mümkün değil.");
  }
  if (totalUnits(game.units) - totalUnits(previous.units) > allow(GROWTH.unitsPerHour, GROWTH.unitsBurst)) {
    return fail(409, "Ordu artışı geçen sürede mümkün değil.");
  }
  if (game.foundedAt !== previous.foundedAt) return fail(409, "Kuruluş zamanı değiştirilemez.");
  return null;
}

/**
 * SUNUCUNUN TÜRETTİĞİ ALANLAR — istemcinin bildirdiği değer YOK SAYILIR.
 *
 * `checkAgainstSimulation` yalnızca kaynak ve nüfus karşılaştırıyordu; itibar,
 * rıza ve sadakat şemada sadece üst sınırla duruyordu. Sonucu somuttu: haraç
 * ihlalinin cezası (itibar 50 → 30) bir sonraki kayıtta `reputation: 100`
 * yazılarak siliniyor, `watchRatio: 100` bedava nöbet veriyordu.
 *
 * Kayıt REDDEDİLMEZ, alan ÜZERİNE YAZILIR: oyuncu ilerlemesini kaybetmesin
 * diye. Alanlar üç sınıfa ayrılır:
 *
 *  1. Tamamen sunucunun: `reputation` (yalnızca app/api/cron yazar) ve
 *     `soldierUnrest` (yalnızca `tick()` türetir) — doğrudan simülasyondan.
 *  2. Simülasyon + tanınmış pay: `popularity`. `tick()` dışında YALNIZCA
 *     şenlik sıçratır (engine/actions.ts, FESTIVAL.mood) ve bir General
 *     turunda en çok MAX_ACTIONS_PER_TURN şenlik yapılabilir; pay budur.
 *     `loyalty` da öyle: uygulanan emirle yükselir, tavanı saatlik hızdır ve
 *     tek turun payı (MAX_ACTIONS_PER_TURN × LOYALTY_STEP.success) korunur.
 *  3. Kralın meşru ayarları: `taxRate`, istihkaklar, `watchRatio`. Bunlar
 *     emirlerle değişir; körlemesine ezilmez, yalnızca MOTORUN KENDİ
 *     kıskaçlarından geçirilir (clampPolicy/clampRation/clampWatch).
 *
 * `capacity` de türetilmiştir: kaydın kendi binalarından yeniden hesaplanır.
 * Şişirilmiş kapasite bir sonraki kaydın nüfus tavanını yükseltiyordu.
 */
function serverDerived(game: GameSave, previous: GameSave | null, simulated: Game | null, elapsedMs: number): GameSave {
  const hours = Math.max(0, elapsedMs) / 3_600_000;
  const optional = (value: number | undefined, clamp: (input: number) => number) =>
    value === undefined ? undefined : clamp(value);
  const loyaltyAllowance = Math.max(LOYALTY_STEP.success * MAX_ACTIONS_PER_TURN, GROWTH.loyaltyPerHour * hours);
  return {
    ...game,
    reputation: simulated ? simulated.reputation : STARTING_REPUTATION,
    popularity: simulated
      ? Math.min(game.popularity, simulated.popularity + FESTIVAL.mood * MAX_ACTIONS_PER_TURN)
      : game.popularity,
    loyalty: previous ? Math.min(game.loyalty, previous.loyalty + loyaltyAllowance) : game.loyalty,
    soldierUnrest: simulated ? simulated.soldierUnrest : game.soldierUnrest,
    capacity: capacityFor(game.buildings),
    taxRate: clampPolicy("taxRate", game.taxRate),
    foodRation: optional(game.foodRation, clampRation),
    aleRation: optional(game.aleRation, clampRation),
    soldierPay: optional(game.soldierPay, clampRation),
    watchRatio: optional(game.watchRatio, clampWatch),
  };
}

export type ValidateOptions = {
  previous: GameSave | null;
  previousUpdatedAt: number | null;
  channelSpeed: number;
  channelName?: string | null;
  now?: number;
};

export function validateGameSave(input: unknown, options: ValidateOptions): ValidationOutcome {
  const parsed = gameSaveSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "kayıt";
    return fail(400, `Geçersiz oyun kaydı: ${path} alanı kabul edilmedi.`);
  }
  const game = parsed.data, now = options.now ?? Date.now();

  const timestampFailure = checkTimestamps(game, now);
  if (timestampFailure) return timestampFailure;

  // Channel adı, oyuncunun gerçekten üye olduğu channel ile eşleşmeli.
  if (options.channelName && game.channel !== options.channelName) {
    return fail(409, "Kayıttaki channel, üyeliğinizle eşleşmiyor.");
  }

  if (!options.previous) {
    const firstFailure = checkFirstSave(game, options.channelSpeed);
    if (firstFailure) return firstFailure;
    return { ok: true, game: serverDerived(game, null, null, 0) };
  }

  // Pazar teklifleri önce: kapanışta hazineye ne gireceğini bu denetim ölçer,
  // aşağıdaki iki denetim de o ölçüye dayanır.
  const marketFailure = checkMarketOrders(game, options.previous, now);
  if (marketFailure) return marketFailure;

  const elapsed = options.previousUpdatedAt !== null ? now - options.previousUpdatedAt : 0;
  // Önceki kaydın sunucu zaman damgası okunamıyorsa büyüme denetimini atlarız;
  // yapı ve tavan denetimleri yine de uygulanmış olur.
  if (options.previousUpdatedAt !== null) {
    const growthFailure = checkGrowth(game, options.previous, elapsed, options.channelSpeed);
    if (growthFailure) return growthFailure;
  }
  // Kaba tavanlardan sonra dar kontrol: sunucunun kendi simülasyonu.
  const horizon = Math.max(now, options.previous.lastTickAt);
  const simulated = tick(options.previous as Game, horizon);
  const simulationFailure = checkAgainstSimulation(game, options.previous, simulated, horizon);
  if (simulationFailure) return simulationFailure;
  return { ok: true, game: serverDerived(game, options.previous, simulated, elapsed) };
}

/**
 * Kayıt zaman damgasını epoch'a çevirir. Postgres timestamptz sürücüden Date olarak
 * gelir; eski D1 kayıtlarındaki "YYYY-MM-DD HH:MM:SS" metni de desteklenmeye devam eder.
 */
export function parseTimestamp(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  const text = value.trim();
  const parsed = Date.parse(text.includes("T") ? text : `${text.replace(" ", "T")}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}
