import { z } from "zod";
import { BUILDABLE_TYPES } from "../engine/catalog";
import { resolveRaids } from "../engine/raids";
import { tick } from "../engine/tick";
import type { Game } from "../engine/types";

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
  buildingLevel: 6,
  buildings: 40,
  unitCount: 100_000,
  unitKinds: 24,
  notices: 80,
  quota: 24,
  taxRate: 50,
} as const;

/** Kuruluş anındaki kanonik başlangıç. İlk buluta kayıtta bunun üstüne çıkılamaz. */
export const STARTING_STATE = {
  resources: { gold: 1000, food: 500, stone: 300, wood: 300, iron: 100, ale: 0 },
  population: 100,
  buildings: 3,
  protectionDays: 4,
} as const;

/** Saatlik makul kazanç tavanları; channel hızıyla çarpılır. Sıçramalar için ayrıca sabit pay verilir. */
const GROWTH = {
  resourcePerHour: 20_000,
  resourceBurst: 50_000,
  populationPerHour: 500,
  populationBurst: 200,
  buildingLevelsPerHour: 6,
  buildingLevelsBurst: 4,
  unitsPerHour: 200,
  unitsBurst: 100,
} as const;

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
  foodRation: finite(200).optional(),
  aleRation: finite(200).optional(),
  soldierPay: finite(200).optional(),
  soldierUnrest: finite(100).optional(),
  mineWorkers: finite(CAPS.population).optional(),
  peopleJoined: finite(1e9).optional(),
  peopleLeft: finite(1e9).optional(),
  migrationDrift: z.number().finite().optional(),
  lastSettlerCallAt: z.number().finite().optional(),
  marketVolume: finite(1e7).optional(),
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
  /**
   * İç hizip baskısı. `.optional()`: eski kayıtlarda yok ve reddedilmiyor.
   * Değeri istemciden HİÇ kabul edilmez (bkz. SERVER_DERIVED); şemada yer alması
   * yalnızca `.strict()` kaydın sunucunun kendi yazdığı alanı reddetmemesi için.
   */
  factionPressure: finite(100).optional(),
  /**
   * Dış kese taşıyıcıları. Hepsi `.optional()` ve hepsi SERVER_DERIVED: bunları
   * yazan tek yer cron'dur, istemcinin bildirdiği değer yok sayılır.
   */
  agitationPressure: finite(100).optional(),
  agitationBribe: finite(100).optional(),
  agitationAt: timestamp.optional(),
  agitationShieldUntil: timestamp.optional(),
  // Akın ve nöbet sistemi. Eski kayıtlarda yok; motor varsayılan uygular.
  watchRatio: finite(100).optional(),
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
  const maxProtection = game.foundedAt + STARTING_STATE.protectionDays * 86_400_000 + CLOCK_SKEW_MS;
  if (game.protectionEndsAt > maxProtection) return fail(400, "Koruma süresi izin verilen sınırı aşıyor.");
  return null;
}

/** İlk buluta kayıt kanonik başlangıcın belirgin biçimde ötesinde olamaz. */
function checkFirstSave(game: GameSave): ValidationFailure | null {
  for (const key of RESOURCE_KEYS) {
    if (game.resources[key] > STARTING_STATE.resources[key] + 5_000) {
      return fail(409, "İlk kayıt başlangıç kaynaklarının ötesinde olamaz.");
    }
  }
  if (game.population > STARTING_STATE.population * 2) return fail(409, "İlk kayıt başlangıç nüfusunu aşamaz.");
  if (game.buildings.length > STARTING_STATE.buildings + 3) return fail(409, "İlk kayıt başlangıç yapılarını aşamaz.");
  if (game.buildings.some(building => building.level > 2)) return fail(409, "İlk kayıtta yapı seviyesi 2'yi aşamaz.");
  if (totalUnits(game.units) > 50) return fail(409, "İlk kayıtta ordu mevcudu geçersiz.");
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
function checkAgainstSimulation(game: GameSave, previous: GameSave, simulated: GameSave, now: number): ValidationFailure | null {
  const horizon = Math.max(now, previous.lastTickAt);
  const looted = resolveRaids(previous as Game, previous.lastTickAt, horizon, previous.resources);
  const loot: Partial<Record<(typeof RESOURCE_KEYS)[number], number>> = { food: looted.foodStolen, gold: looted.goldStolen };
  for (const key of RESOURCE_KEYS) {
    const ceiling = (simulated.resources[key] + (loot[key] ?? 0)) * (1 + SIMULATION_TOLERANCE) + SIMULATION_FLOOR;
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
  // Sunucu saatine göre geçen süre; en az bir dakikalık pay tanınır.
  const hours = Math.max(elapsedMs, 60_000) / 3_600_000, speed = Math.max(1, channelSpeed);
  const allow = (perHour: number, burst: number) => perHour * hours * speed + burst;

  for (const key of RESOURCE_KEYS) {
    const gain = game.resources[key] - previous.resources[key];
    if (gain > allow(GROWTH.resourcePerHour, GROWTH.resourceBurst)) {
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
 * SUNUCU-TÜREVİ ALANLAR — 1. sınıf.
 *
 * Bu alanlarda istemcinin bildirdiği değer TAMAMEN YOK SAYILIR; yerine
 * sunucunun kendi `tick(previous)` sonucundaki değer yazılır. Sebep: oyun
 * durumu hâlâ istemcide hesaplanıyor ve bu alanlar birer CEZA taşıyıcısıdır —
 * istemci kendi lehine yazabilirse mekaniğin tamamı anlamını yitirir.
 *
 * Tavan denetimi (`checkGrowth`/`checkAgainstSimulation`) burada yetmez: hizip
 * baskısı bir kaynak değil, dolayısıyla "üretim eğrisinin üstüne çıkamaz"
 * kuralı ona hiç dokunmuyordu. Tek doğru savunma alanı ezmektir.
 *
 * Liste her yeni taşıyıcı mekanikle büyür. Sunucunun kendi yazdığı (cron)
 * değerler `previous`ta durduğu ve `tick` onlara dokunmadığı için, dokunulmayan
 * bir alan doğal olarak olduğu gibi taşınır.
 */
export const SERVER_DERIVED = [
  "factionPressure",
  // Dış kese: yazan tek yer cron. `tick` bunlara dokunmadığı için `simulated`
  // değeri `previous`takiyle aynıdır — yani istemcinin yazdığı her şey silinir.
  "agitationPressure",
  "agitationBribe",
  "agitationAt",
  "agitationShieldUntil",
] as const;

export function applyServerDerived(game: GameSave, simulated: GameSave | null): GameSave {
  const patched: Record<string, unknown> = { ...game };
  for (const key of SERVER_DERIVED) {
    const value = simulated ? (simulated as Record<string, unknown>)[key] : undefined;
    if (value === undefined) delete patched[key];
    else patched[key] = value;
  }
  return patched as GameSave;
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
    const firstFailure = checkFirstSave(game);
    if (firstFailure) return firstFailure;
    // İlk kayıtta türetilecek geçmiş yok: taşıyıcı alanlar sıfırlanır.
    return { ok: true, game: applyServerDerived(game, null) };
  }

  // Önceki kaydın sunucu zaman damgası okunamıyorsa büyüme denetimini atlarız;
  // yapı ve tavan denetimleri yine de uygulanmış olur.
  if (options.previousUpdatedAt !== null) {
    const growthFailure = checkGrowth(game, options.previous, now - options.previousUpdatedAt, options.channelSpeed);
    if (growthFailure) return growthFailure;
  }
  // Sunucunun kendi simülasyonu iki işi birden yapar: kaba tavanlardan sonraki
  // dar kaynak kontrolü ve sunucu-türevi alanların kaynağı. Tek kez hesaplanır.
  const simulated = tick(options.previous as Game, Math.max(now, options.previous.lastTickAt)) as GameSave;
  const simulationFailure = checkAgainstSimulation(game, options.previous, simulated, now);
  if (simulationFailure) return simulationFailure;
  return { ok: true, game: applyServerDerived(game, simulated) };
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
