import { sql } from "drizzle-orm";
import { bigint, boolean, doublePrecision, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { POPULACE_PERSONA_IDS } from "../engine/populace-persona";
import { DEMAND_TONES } from "../engine/populace-voice";
import { INTEL_MISSION_KINDS } from "../engine/intel";

/**
 * Postgres şeması. Epoch-milisaniye alanları bigint'tir (JS number olarak okunur),
 * kayıt zamanları timestamptz'dir. Metin enum'ları pg ENUM tipi yerine text +
 * çalışma zamanı kısıtı olarak tutulur; böylece değer eklemek migration gerektirmez.
 */

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["player", "admin"] }).notNull().default("player"),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("idx_users_email").on(table.email),
  // Tek admin kilidi: kısmi unique index, yarışta ikinci admini DB seviyesinde reddeder.
  uniqueIndex("idx_users_single_admin").on(table.role).where(sql`${table.role} = 'admin'`),
]);

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("idx_sessions_user").on(table.userId)]);

export const channels = pgTable("channels", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  speed: integer("speed").notNull().default(1),
  durationDays: integer("duration_days").notNull(),
  maxPlayers: integer("max_players").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdBy: text("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("idx_channels_slug").on(table.slug)]);

export const channelMembers = pgTable("channel_members", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  /** Kral müzakereye kapalıysa kimse masa açamaz; kendi BYOK kredisini korur. */
  acceptsNegotiation: boolean("accepts_negotiation").notNull().default(true),
  /**
   * Kral dış keseye ve haydut yönlendirmesine kapalıysa hiçbir komşu ona
   * propaganda gönderemez. `acceptsNegotiation`'ın ikizi: taciz aracına
   * dönüşmesine karşı ilk savunma hattı.
   */
  acceptsAgitation: boolean("accepts_agitation").notNull().default(true),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.channelId] }),
  index("idx_channel_members_channel").on(table.channelId, table.status),
]);

export const gameSaves = pgTable("game_saves", {
  userId: text("user_id").primaryKey(),
  gameState: text("game_state").notNull(),
  revision: integer("revision").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const llmCredentials = pgTable("llm_credentials", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["openai", "anthropic"] }).notNull(),
  model: text("model").notNull(),
  encryptedKey: text("encrypted_key").notNull(),
  iv: text("iv").notNull(),
  keyVersion: text("key_version").notNull().default("v1"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * HALK-AI KİMLİK BİLGİSİ — token'ı oyun kurucusu (admin) öder.
 *
 * `llm_credentials`'ın kardeşi DEĞİL, ayrı bir modeli: orada sahip oyuncudur ve
 * kendi Generalinin faturasını kendi öder; burada sahip channel'dır ve halkın
 * faturasını admin öder (bkz. `docs/plans/2026-08-22-canli-dunya-ve-halk-ai-vizyonu.md`,
 * §2 madde 1 ve Fikir 0). Aynı tabloya sığmazlar: `llm_credentials`'ın birincil
 * anahtarı `user_id`, yani "kullanıcı başına tek satır" — Halk-AI'da ise bir
 * channel'ın varsayılanı ve o channel içindeki krallık override'ları BİR ARADA
 * yaşamak zorunda.
 *
 * `user_id` NULL ise satır **channel varsayılanıdır**; doluysa yalnızca o
 * krallığın halkı için geçerli **override**'dır. Çözümleme sırası tek yerde
 * yaşar: `server/populace-ai-credentials.ts` → override > varsayılan > yok.
 *
 * İki KISMİ unique index bu ikiliği veritabanı seviyesinde tutar. Düz bir
 * `unique(channel_id, user_id)` yetmezdi: Postgres NULL'ları birbirinden farklı
 * sayar, yani aynı channel'a iki (hatta yüz) varsayılan satır girebilirdi ve
 * hangisinin kullanıldığı sıralamaya kalırdı.
 *
 * Anahtar burada YALNIZCA şifreli durur (`encrypted_key`/`iv`), AES-GCM'in
 * ek verisi kapsamı taşır (`server/byok-crypto.ts` → `populaceChannelScope` /
 * `populaceKingdomScope`): bir channel'ın anahtarı başka bir channel adına
 * çözülemez. Bu iki sütun HİÇBİR cevaba, loga ya da panele girmez
 * (CLAUDE.md kısıt #4).
 */
export const populaceCredentials = pgTable("populace_credentials", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  /** NULL = channel varsayılanı; dolu = o krallığa özel override. */
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  /** Kişilik listesi motorda TEK KAYNAKTA yaşar: engine/populace-persona.ts. */
  persona: text("persona", { enum: POPULACE_PERSONA_IDS }).notNull(),
  provider: text("provider", { enum: ["openai", "anthropic"] }).notNull(),
  model: text("model").notNull(),
  encryptedKey: text("encrypted_key").notNull(),
  iv: text("iv").notNull(),
  keyVersion: text("key_version").notNull().default("v1"),
  /** Kimlik bilgisini giren admin; faturanın sahibi kim olduğu denetim için tutulur. */
  createdBy: text("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_populace_credentials_default").on(table.channelId).where(sql`${table.userId} is null`),
  uniqueIndex("idx_populace_credentials_kingdom").on(table.channelId, table.userId).where(sql`${table.userId} is not null`),
]);

export const intelDefenses = pgTable("intel_defenses", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  level: integer("level").notNull().default(1),
  activeUntil: bigint("active_until", { mode: "number" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const intelMissions = pgTable("intel_missions", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  sourceUserId: text("source_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetUserId: text("target_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["pending", "succeeded", "failed", "detected"] }).notNull().default("pending"),
  /**
   * Görev türü (plan belgesi Fikir 5). `scout` standart keşif, `deep` derin
   * gözetleme: pahalı, daha düşük ihtimalli ve başarılı olursa rapora hedef
   * halkın KABA moral etiketini ekleyen ayrı bir görev. Liste motordan gelir
   * (`engine/intel.ts` → `INTEL_MISSION_KINDS`); varsayılan `scout` olduğu
   * için bu sütun eklenmeden önce yazılmış bütün satırlar keşif sayılır.
   */
  kind: text("kind", { enum: INTEL_MISSION_KINDS }).notNull().default("scout"),
  successChance: integer("success_chance").notNull(),
  detectionChance: integer("detection_chance").notNull(),
  completesAt: bigint("completes_at", { mode: "number" }).notNull(),
  report: text("report"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (table) => [
  // Aynı hedefe ikinci bir ajan yolda olamaz; eşzamanlı isteklerde koruyan kısıt budur.
  uniqueIndex("idx_intel_missions_source_target_pending").on(table.sourceUserId, table.targetUserId).where(sql`${table.status} = 'pending'`),
  index("idx_intel_missions_channel").on(table.channelId),
]);

export const sharedMines = pgTable("shared_mines", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Ortak Demir Damarı"),
  oreRemaining: integer("ore_remaining").notNull().default(100000),
  extractedOre: integer("extracted_ore").notNull().default(0),
  lastTickAt: bigint("last_tick_at", { mode: "number" }).notNull(),
  /**
   * BÖLGE SAHİBİ (plan belgesi Fikir 22) ve sahipliğin tartıldığı pencere.
   *
   * Sahiplik ANLIK hesaplanmaz, madenin satırında DURUR: mutlak zamana oturan
   * pencerelerin başında bir kez tartılır (`engine/mine.ts` →
   * `influenceWindowAt`) ve pencere boyunca değişmez. Bu bir denge kararıdır
   * (sahiplik kapma yarışını önler) ve aynı zamanda kısıt #2'nin gereği:
   * hesap kaç parçaya bölünürse bölünsün sahip aynı kalsın.
   *
   * `set null`: sahibin hesabı silinirse sütun boşa düşer, madenin satırı
   * silinmez.
   */
  influenceUserId: text("influence_user_id").references(() => users.id, { onDelete: "set null" }),
  influenceWindow: bigint("influence_window", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("idx_shared_mines_channel").on(table.channelId)]);

/**
 * Madende çalışan krallıklar.
 *
 * Cevher artık oyuncunun kaydına GERÇEKTEN yazılıyor (bkz. app/api/mine/route.ts).
 * Üç alan bunun içindir:
 *  - `pendingOre`: çıkarılmış ama henüz kayda geçmemiş cevher. KESİRLİ tutulur;
 *    tam sayıya yuvarlansaydı 10 saniyede bir yoklanan madende üretim hep 0'a
 *    inerdi (5 işçi × 4 cevher/sa × 10 sn = 0,011 cevher).
 *  - `lastDeliveryAt`: son teslimat anı. Her teslimat kaydın sürümünü artırdığı
 *    için aralıklı yapılır; yoksa Kralın açık sekmesi sürekli 409 yerdi.
 *  - `deliveredOre`: bugüne kadar teslim edilen toplam; panelde gösterilir.
 */
export const sharedMineWorkers = pgTable("shared_mine_workers", {
  mineId: text("mine_id").notNull().references(() => sharedMines.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workers: integer("workers").notNull().default(5),
  pendingOre: doublePrecision("pending_ore").notNull().default(0),
  deliveredOre: integer("delivered_ore").notNull().default(0),
  /**
   * NÜFUZ ÖLÇÜTÜ (Fikir 22): zaman ağırlıklı ortalama işçi sayısı. ANLIK
   * `workers` değil bu sütun tartılır; anlık olsaydı krallıklar her hesapta
   * işçi sayısını oynatıp sahiplik kapma yarışına girerdi. Kapalı çözümlü
   * üstel olarak ilerler (`engine/mine.ts` → `advanceWorkerAvg`), yani
   * hesabın kaç adıma bölündüğü sonucu değiştirmez. Varsayılan 0: sütun
   * eklenmeden önceki satırlar sahipliği sıfırdan kazanır.
   */
  workerAvg: doublePrecision("worker_avg").notNull().default(0),
  lastDeliveryAt: bigint("last_delivery_at", { mode: "number" }).notNull().default(0),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.mineId, table.userId] })]);

// Kralın gece emri. Kayıt yoksa General arka planda hiç uyanmaz.
// Bir Kralın birden fazla kalıcı emri olabilir. Eskiden user_id birincil
// anahtardı ve yeni emir eskisini SESSİZCE eziyordu; Kral listesini göremiyordu.
export const standingOrders = pgTable("standing_orders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull(),
  instruction: text("instruction").notNull(),
  autonomy: text("autonomy", { enum: ["autonomous", "ask"] }).notNull().default("ask"),
  status: text("status", { enum: ["pending_approval", "active", "paused"] }).notNull().default("pending_approval"),
  maxActionsPerWake: integer("max_actions_per_wake").notNull().default(1),
  dailyActionCap: integer("daily_action_cap").notNull().default(8),
  actionsToday: integer("actions_today").notNull().default(0),
  dayStartedAt: bigint("day_started_at", { mode: "number" }).notNull(),
  lastRunAt: bigint("last_run_at", { mode: "number" }),
  lastOutcome: text("last_outcome"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("idx_standing_orders_status").on(table.status), index("idx_standing_orders_user").on(table.userId)]);

// General riskli bulup teyit istediği emri burada bekletir.
export const pendingDecisions = pgTable("pending_decisions", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  reasons: text("reasons").notNull(),
  riskLevel: text("risk_level", { enum: ["elevated", "severe"] }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * General'in defteri: Kral hakkında biriken kalıcı hafıza.
 *
 * Oyun kaydı blob'u yerine ayrı tabloda tutulur; çünkü kayıt istemcide
 * hesaplanıp sunucuya gönderiliyor (bkz. server/save-validation.ts). Kral kendi
 * sicilini düzenleyebilseydi defterin bütün anlamı kalkardı. Burada yazma yetkisi
 * yalnızca sunucudadır.
 *
 * Birincil anahtar (user_id, kind): aynı türden olay yeni satır açmaz, mevcut
 * satırın `weight` değeri artar. Defter böyle sınırlı kalır.
 */
export const generalLedger = pgTable("general_ledger", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  weight: integer("weight").notNull().default(1),
  firstSeenAt: bigint("first_seen_at", { mode: "number" }).notNull(),
  lastSeenAt: bigint("last_seen_at", { mode: "number" }).notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.kind] })]);

/**
 * General'in Kral'dan açık talepleri. Durumdan türetilir; burada yalnızca ne
 * zaman açıldıkları (`raisedAt`) saklanır ki General "üç gündür istiyorum"
 * diyebilsin. Talep karşılanınca satır silinir ve deftere kayıt düşer.
 */
export const generalRequests = pgTable("general_requests", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  text: text("text").notNull(),
  severity: text("severity", { enum: ["normal", "urgent"] }).notNull().default("normal"),
  raisedAt: bigint("raised_at", { mode: "number" }).notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.kind] })]);

/**
 * HALKIN SESİ — halkın ve garnizonun Kral'dan açık talepleri.
 *
 * `general_requests` tablosunun birebir kardeşi ve aynı sebeple ayrı tabloda:
 * oyun kaydı istemcide hesaplanıyor, Kral kendi halkının taleplerini
 * silebilseydi mekaniğin anlamı kalmazdı. Yazma yetkisi yalnızca sunucudadır.
 *
 * İki zaman damgası ayrı tutulur:
 *   · `seenAt`  — koşul ilk görüldüğü an. Süre şartı buradan sayılır, yani
 *                 anlık dalgalanma talep açmaz.
 *   · `openedAt`— talep fiilen açıldığı an; "kaç gündür istiyoruz" bundan okunur.
 * Koşul düzelince satır silinir ve süre baştan sayılır.
 *
 * `text` sütunu artık yalnızca kalıcılık değil ÖNBELLEK: Halk-AI'sı olan bir
 * channel'da cümleyi model üretir (plan belgesi Fikir 2) ve o cümle burada
 * saklanır. `tone` cümlenin hangi sertlik kademesinde üretildiğini söyler;
 * kademe değişmedikçe model yeniden çağrılmaz. NULL = cümle deterministik
 * şablondan geliyor (Halk-AI yok). Bu ayrım aynı zamanda sağlayıcı hatasındaki
 * güvenlik ağının koşulu: yalnızca `tone` dolu bir satırın metni "son bilinen
 * halkın sesi" sayılır (bkz. `server/populace-narrator.ts`).
 */
export const populaceDemands = pgTable("populace_demands", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  voice: text("voice", { enum: ["commons", "garrison"] }).notNull().default("commons"),
  text: text("text").notNull(),
  /** Kademe listesi motorda TEK KAYNAKTA yaşar: engine/populace-voice.ts. */
  tone: text("tone", { enum: DEMAND_TONES }),
  severity: text("severity", { enum: ["normal", "urgent"] }).notNull().default("normal"),
  seenAt: bigint("seen_at", { mode: "number" }).notNull(),
  openedAt: bigint("opened_at", { mode: "number" }),
  lastNoticeAt: bigint("last_notice_at", { mode: "number" }),
}, (table) => [primaryKey({ columns: [table.userId, table.kind] })]);

/**
 * DIŞ PROPAGANDA görev satırı — kese ve haydut yönlendirmesi.
 *
 * `intel_missions` tablosuna EKLENMEDİ, çünkü semantiği başka: ajan bilgi
 * getirir ve zarla başarır/başarısız olur; kese gerçek para harcar, etkisi
 * kesindir ve yalnızca ifşası iki kademelidir.
 *
 * `pair_window` çift bekleme kuralını VERİTABANI SEVİYESİNDE tutar: aynı çifte
 * aynı pencerede ikinci satır yazılamaz (kısmi UNIQUE index). Uygulama katmanı
 * yarışırsa ikinci istek veritabanından reddedilir, sayaç ezilmez.
 */
export const agitations = pgTable("agitations", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  sourceUserId: text("source_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetUserId: text("target_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["gold_commons", "gold_garrison", "goods_glut", "raid_lure"] }).notNull(),
  status: text("status", { enum: ["pending", "settled", "exposed"] }).notNull().default("pending"),
  /** Ödenen bedel; defter için tutulur, etkiyi belirlemez (fiyat sabittir). */
  cost: integer("cost").notNull(),
  costResource: text("cost_resource").notNull().default("gold"),
  sentAt: bigint("sent_at", { mode: "number" }).notNull(),
  completesAt: bigint("completes_at", { mode: "number" }).notNull(),
  /** Çift bekleme penceresinin indeksi (bkz. engine/agitation.ts). */
  pairWindow: bigint("pair_window", { mode: "number" }).notNull(),
  settledAt: bigint("settled_at", { mode: "number" }),
}, (table) => [
  uniqueIndex("idx_agitations_pair_window").on(table.sourceUserId, table.targetUserId, table.pairWindow),
  index("idx_agitations_pending").on(table.status, table.completesAt),
  index("idx_agitations_source").on(table.sourceUserId, table.sentAt),
  index("idx_agitations_target").on(table.targetUserId, table.sentAt),
]);

/**
 * GÖÇ KUYRUĞU — bir krallıktan ayrılan halkın channel'daki başka bir krallığa
 * ulaşması (bkz. engine/migration.ts).
 *
 * `agitations` tablosunun küçük kardeşi: aynı "kaynakta olay olur, cron
 * hedefin kaydına gecikmeli yazar" deseni, ama burada gönderen bir hedef
 * SEÇMEZ (nüfus kendiliğinden ayrılır) ve maliyet yoktur — bu yüzden
 * `agitations`'daki fiyat, çift bekleme ve tavan alanları burada karşılıksızdır.
 * Hedef, cron `completesAt` anında GÜNCEL channel üyeleri arasından seçilir;
 * kuyruğa alma anında SEÇİLMEZ, çünkü o ana kadar hedeflerin boş konutu
 * değişmiş olabilir (bkz. app/api/cron/route.ts → settleMigrations).
 */
export const migrations = pgTable("migrations", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  sourceUserId: text("source_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Ayrılan kişi sayısı; `engine/tick.ts`'in `peopleLeft` defterinden türer. */
  count: integer("count").notNull(),
  sentAt: bigint("sent_at", { mode: "number" }).notNull(),
  completesAt: bigint("completes_at", { mode: "number" }).notNull(),
  status: text("status", { enum: ["pending", "settled"] }).notNull().default("pending"),
  settledAt: bigint("settled_at", { mode: "number" }),
}, (table) => [
  index("idx_migrations_pending").on(table.status, table.completesAt),
  index("idx_migrations_source").on(table.sourceUserId, table.sentAt),
]);

// Sabit pencereli hız sınırı sayaçları; tek upsert deyimiyle atomik artar.
export const rateLimits = pgTable("rate_limits", {
  bucket: text("bucket").primaryKey(),
  count: integer("count").notNull().default(1),
  windowStart: bigint("window_start", { mode: "number" }).notNull(),
});

// --- Müzakere: iki krallığın Generallerinin masası ------------------------
// Kural katmanı engine/negotiation.ts içindedir; burada yalnızca kalıcılık var.
export const negotiations = pgTable("negotiations", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  initiatorId: text("initiator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetId: text("target_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  topic: text("topic", { enum: ["tribute", "non_aggression", "alliance", "passage", "ultimatum"] }).notNull(),
  status: text("status", { enum: ["open", "awaiting_king", "agreed", "declined", "expired"] }).notNull().default("open"),
  turns: integer("turns").notNull().default(0),
  /** Sunulmuş şart (JSON). Kral onaylayınca anlaşmaya dönüşür. */
  proposed: text("proposed"),
  proposedBy: text("proposed_by", { enum: ["initiator", "target"] }),
  openedAt: bigint("opened_at", { mode: "number" }).notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  lastTurnAt: bigint("last_turn_at", { mode: "number" }).notNull(),
}, (table) => [
  index("idx_negotiations_initiator").on(table.initiatorId, table.status),
  index("idx_negotiations_target").on(table.targetId, table.status),
]);

export const negotiationMessages = pgTable("negotiation_messages", {
  id: text("id").primaryKey(),
  negotiationId: text("negotiation_id").notNull().references(() => negotiations.id, { onDelete: "cascade" }),
  side: text("side", { enum: ["initiator", "target"] }).notNull(),
  /** General mi konuştu Kral mı? Kral yokken General bağlayamaz. */
  speaker: text("speaker", { enum: ["general", "king"] }).notNull().default("general"),
  body: text("body").notNull(),
  at: bigint("at", { mode: "number" }).notNull(),
}, (table) => [index("idx_negotiation_messages_table").on(table.negotiationId, table.at)]);

// Onaylanmış anlaşma. Haraç ödemeleri cron'da bu tablodan yürür.
export const agreements = pgTable("agreements", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  negotiationId: text("negotiation_id"),
  topic: text("topic", { enum: ["tribute", "non_aggression", "alliance", "passage", "ultimatum"] }).notNull(),
  /** Haraçta ödeyen ve alan. Diğer konularda iki taraf da eşittir. */
  payerId: text("payer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  payeeId: text("payee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  terms: text("terms").notNull(),
  startedAt: bigint("started_at", { mode: "number" }).notNull(),
  endsAt: bigint("ends_at", { mode: "number" }).notNull(),
  everyHours: integer("every_hours").notNull().default(6),
  paidCount: integer("paid_count").notNull().default(0),
  /** Ödenemeyen vade sayısı; belli sayıda kaçırma anlaşmayı bozar. */
  missedCount: integer("missed_count").notNull().default(0),
  status: text("status", { enum: ["active", "completed", "broken"] }).notNull().default("active"),
}, (table) => [
  index("idx_agreements_payer").on(table.payerId, table.status),
  index("idx_agreements_payee").on(table.payeeId, table.status),
  // Bir masadan BİR anlaşma çıkar. İki eşzamanlı imza isteği iki aktif anlaşma
  // yaratıyor ve cron ikisini birden tahsil ediyordu; haracı ALAN taraf bunu
  // kendi lehine tetikleyebiliyordu. Uçtaki koşullu UPDATE mantık seviyesinde,
  // bu kısıt veritabanı seviyesinde aynı yarışı kapatır.
  uniqueIndex("idx_agreements_negotiation").on(table.negotiationId),
]);
