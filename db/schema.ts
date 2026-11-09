import { sql } from "drizzle-orm";
import { bigint, boolean, doublePrecision, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { POPULACE_PERSONA_IDS } from "../engine/populace-persona";
import { DEMAND_TONES } from "../engine/populace-voice";

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
   * Eski sürümlerden kalan uyumluluk kolonu. Oyun artık gelen dolaylı
   * faaliyetleri kapatmaya izin vermez; uygulama bu alanı okumaz veya yazmaz.
   * Kolon güvenli bir şema temizliğiyle sonraki migration'da kaldırılabilir.
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
  /** OpenAI için anlatım çeşitliliği; Anthropic uyarlamalı düşünmede varsayılanı kullanır. */
  temperature: doublePrecision("temperature"),
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
  /** Normal keşif açık çerçeveyi; derin gözetleme yalnız kaba halk ruh hâlini de getirir. */
  kind: text("kind", { enum: ["scout", "deep_observation"] }).notNull().default("scout"),
  status: text("status", { enum: ["pending", "succeeded", "failed", "detected"] }).notNull().default("pending"),
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

/**
 * KALICI CASUS AĞI — tek seferlik `intel_missions`dan kasıtlı olarak ayrı.
 *
 * Keşif raporu yalnızca geçmişteki bir anı taşır; ağ ise hedefte kaldığı sürece
 * o anki açık bilgiyi düzenli yeniler. `latest_report` Kralın kendi gözü için
 * saklanır, hedefe hiç inmez. Karşı-istihbarat ağı yakalarsa satır silinmez;
 * tarihçe ve Defter için `exposed` olarak kalır.
 */
export const spyNetworks = pgTable("spy_networks", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  sourceUserId: text("source_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetUserId: text("target_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["deploying", "active", "exposed", "recalled"] }).notNull().default("deploying"),
  deploysAt: bigint("deploys_at", { mode: "number" }).notNull(),
  nextReportAt: bigint("next_report_at", { mode: "number" }),
  lastReportAt: bigint("last_report_at", { mode: "number" }),
  latestReport: text("latest_report"),
  exposedAt: bigint("exposed_at", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_spy_networks_active_pair").on(table.sourceUserId, table.targetUserId)
    .where(sql`${table.status} in ('deploying', 'active')`),
  index("idx_spy_networks_due").on(table.status, table.deploysAt, table.nextReportAt),
  index("idx_spy_networks_source").on(table.sourceUserId, table.createdAt),
]);

export const sharedMines = pgTable("shared_mines", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Ortak Demir Damarı"),
  /** Aynı channel'da tükenen damardan sonra kaçıncı saha olduğu. */
  vein: integer("vein").notNull().default(0),
  /** Aktif damarın haritadaki kalıcı konumu. */
  positionX: integer("position_x").notNull().default(-52),
  positionZ: integer("position_z").notNull().default(8),
  oreRemaining: integer("ore_remaining").notNull().default(100000),
  extractedOre: integer("extracted_ore").notNull().default(0),
  lastTickAt: bigint("last_tick_at", { mode: "number" }).notNull(),
  /** Son tamamlanan 24 oyun saatlik üretim penceresinin nüfuz sahibi. */
  influenceOwnerId: text("influence_owner_id").references(() => users.id, { onDelete: "set null" }),
  /** Yeni nüfuz penceresinde birikmiş üretim oyun-saatleri. */
  influenceGameHours: doublePrecision("influence_game_hours").notNull().default(0),
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
  lastDeliveryAt: bigint("last_delivery_at", { mode: "number" }).notNull().default(0),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.mineId, table.userId] })]);

/**
 * Ortak madenin nüfuz penceresindeki emek defteri. İşçi ayrıldıktan sonra
 * satırı silinmez; aksi halde son 24 oyun saatindeki emeğini geri alarak
 * liderlik yarışını hileyle değiştirebilirdi. Pencere kapanınca yenilenir.
 */
export const sharedMineInfluence = pgTable("shared_mine_influence", {
  mineId: text("mine_id").notNull().references(() => sharedMines.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workerHours: doublePrecision("worker_hours").notNull().default(0),
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
  /** Riskli emrin halkta yaratacağı nitel tepki; kesin puan ya da ham veri tutulmaz. */
  peoplePulse: text("people_pulse"),
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
 * HALKIN GÜNLÜĞÜ — açık talep olmayan, yalnızca atmosfer yaratan kamusal not.
 *
 * Bu satırlar General belleğine ya da oyun durumuna girmez. `source_key`
 * saatlik cron yarışında aynı gündemin iki kez yazılmasını DB seviyesinde
 * engeller; `text` yalnız Halk-AI'nın ürettiği kısa cümledir.
 */
export const populaceFeed = pgTable("populace_feed", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["food", "construction", "garrison", "opposition", "world", "neighbor"] }).notNull(),
  text: text("text").notNull(),
  sourceKey: text("source_key").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
}, (table) => [
  uniqueIndex("idx_populace_feed_source").on(table.userId, table.sourceKey),
  index("idx_populace_feed_recent").on(table.userId, table.createdAt),
]);

/**
 * İÇ MUHALEFET KOALİSYON MASASI. Metin Halk-AI'dan gelir; istenebilecek
 * politika ve kabul/red sonucunun kuralı `engine/faction.ts`tedir. Bir
 * krallıkta yalnız bir açık masa olur; ret sayısı sonraki Halk-AI sözünün
 * sertliğini belirler.
 */
export const factionCoalitions = pgTable("faction_coalitions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["tax_relief", "food_relief"] }).notNull(),
  text: text("text").notNull(),
  policyKey: text("policy_key", { enum: ["taxRate", "foodRation"] }).notNull(),
  policyValue: integer("policy_value").notNull(),
  sourceKey: text("source_key").notNull(),
  status: text("status", { enum: ["open", "accepted", "withdrawn"] }).notNull().default("open"),
  openedAt: bigint("opened_at", { mode: "number" }).notNull(),
  refusalCount: integer("refusal_count").notNull().default(0),
  lastAnsweredAt: bigint("last_answered_at", { mode: "number" }),
}, (table) => [uniqueIndex("idx_faction_coalitions_user").on(table.userId)]);

/** Kralın sorduğu bağlayıcı olmayan halk oylamalarının kalıcı sonucu. */
export const referendums = pgTable("referendums", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  topic: text("topic", { enum: ["tax_increase", "tax_relief", "food_cut", "food_relief"] }).notNull(),
  question: text("question").notNull(),
  support: integer("support").notNull(),
  verdict: text("verdict", { enum: ["supported", "divided", "opposed"] }).notNull(),
  text: text("text").notNull(),
  askedAt: bigint("asked_at", { mode: "number" }).notNull(),
}, (table) => [index("idx_referendums_user_recent").on(table.userId, table.askedAt)]);

/**
 * KADER ANLARI — General'in büyük eşikte kendi başlattığı, bağlayıcı olmayan
 * ikilemler. `sourceKey` aynı sezon/eşik için ikinci kez açılmayı DB düzeyinde
 * engeller; Kralın tartışmayı seçmesi hiçbir fermanı kendiliğinden çalıştırmaz.
 */
export const fateEvents = pgTable("fate_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["defiant_opposition", "empty_tables", "garrison_breaking"] }).notNull(),
  sourceKey: text("source_key").notNull(),
  title: text("title").notNull(),
  text: text("text").notNull(),
  discussion: text("discussion").notNull(),
  status: text("status", { enum: ["open", "discussed", "deferred"] }).notNull().default("open"),
  openedAt: bigint("opened_at", { mode: "number" }).notNull(),
  resolvedAt: bigint("resolved_at", { mode: "number" }),
}, (table) => [
  uniqueIndex("idx_fate_events_source").on(table.userId, table.sourceKey),
  index("idx_fate_events_user_recent").on(table.userId, table.openedAt),
]);

/**
 * KRALİYET DİVANI GÜNDEMİ. Görüşler ekran açılışında üretilmez: cron güncel
 * oyun durumunda bu tek satırı üretir, Kral okuyana kadar aynı kayıt kalır.
 * `readAt` boşken yalnızca 24 saatlik hatırlatma yeniden üretilebilir.
 */
export const councilBriefings = pgTable("council_briefings", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  voices: text("voices").notNull(),
  connections: text("connections").notNull(),
  sourceKey: text("source_key").notNull(),
  generatedAt: bigint("generated_at", { mode: "number" }).notNull(),
  /** Olağan bir sonraki toplantı. Acil değişim bu tarihten önce yeni gündem açabilir. */
  nextAt: bigint("next_at", { mode: "number" }),
  /** Kralın talebi, uygun ilk toplantı saatine alınır; ekran açılışı model çağırmaz. */
  callRequestedAt: bigint("call_requested_at", { mode: "number" }),
  callDueAt: bigint("call_due_at", { mode: "number" }),
  /** Oturum boyunca oluşan sözlü tutanak; kapanınca geçmişe de aynen taşınır. */
  discussion: text("discussion").notNull().default("[]"),
  /** Açılış → Generalin yönetimi → kamaraların yanıtı → sonuç. */
  sessionStage: text("session_stage").notNull().default("concluded"),
  sessionNextAt: bigint("session_next_at", { mode: "number" }),
  sessionEndsAt: bigint("session_ends_at", { mode: "number" }),
  readAt: bigint("read_at", { mode: "number" }),
  reminderCount: integer("reminder_count").notNull().default(0),
  /** Aynı anda çalışan iki cron turunun aynı üç modeli çağırmasını engeller. */
  refreshingAt: bigint("refreshing_at", { mode: "number" }),
}, (table) => [index("idx_council_briefings_unread").on(table.readAt, table.generatedAt)]);

/**
 * DİVAN GEÇMİŞİ. Güncel gündem tek satırda kalır; önceki toplantılar burada
 * saklanır. Kral ekranında son üçü, arşivde daha eski kayıtlar gösterilebilir.
 */
export const councilMeetingHistory = pgTable("council_meeting_history", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sourceKey: text("source_key").notNull(),
  voices: text("voices").notNull(),
  generatedAt: bigint("generated_at", { mode: "number" }).notNull(),
  nextAt: bigint("next_at", { mode: "number" }),
  /** Olağan, Kral çağrısı veya kritik değişimle açılan oturum ayrımı. */
  meetingType: text("meeting_type").notNull().default("ordinary"),
  /** Toplantı tutanağı, son üç Divan görünümünde tekrar okunabilsin diye saklanır. */
  discussion: text("discussion").notNull().default("[]"),
  sessionStage: text("session_stage").notNull().default("concluded"),
  readAt: bigint("read_at", { mode: "number" }),
  /** Kralın bu toplantıyı gördüğünü açıkça belirtir; oyun emirleri Defter'de kalır. */
  outcome: text("outcome").notNull().default("Gündem Kralın yanıtını bekliyor."),
}, (table) => [index("idx_council_meeting_history_recent").on(table.userId, table.generatedAt)]);

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
  kind: text("kind", { enum: ["gold_commons", "support_movement", "gold_garrison", "goods_glut", "raid_lure"] }).notNull(),
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

/**
 * EŞZAMANSIZ SEFERLER — iki krallığın ortak durumu istemci kaydına sığmaz.
 *
 * Kayıt blob'u yalnız bir Krala aittir ve istemcinin kaydettiği sürümle
 * güncellenir. Savaş ise iki tarafın aynı anda okuduğu, cron'un ilerlettiği
 * bir olaydır; bu yüzden burada, sunucu mülkiyetinde yaşar.
 */
export const wars = pgTable("wars", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  attackerId: text("attacker_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  defenderId: text("defender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  objective: text("objective", { enum: ["raid", "concession", "siege", "blockade"] }).notNull(),
  status: text("status", { enum: ["gathering", "marching", "engaged", "siege", "blockade", "returning", "resolved", "cancelled"] }).notNull().default("gathering"),
  targetTerrain: text("target_terrain", { enum: ["plain", "forest", "mountain", "riverbank"] }).notNull(),
  distance: doublePrecision("distance").notNull(),
  marchHours: doublePrecision("march_hours").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  departsAt: bigint("departs_at", { mode: "number" }).notNull(),
  arrivesAt: bigint("arrives_at", { mode: "number" }).notNull(),
  /** Saha çatışmasının 0=temas, 1=atış, 2=hat, 3=takip ilerleme damgası. */
  battlePhase: integer("battle_phase").notNull().default(0),
  /** Bir sonraki çatışma safhasının en erken çözüleceği an. */
  nextBattleAt: bigint("next_battle_at", { mode: "number" }),
  /** Savunanın bu seferi ilk görebileceği an; taze karşı-istihbarat bunu erkene çeker. */
  defenderAlertAt: bigint("defender_alert_at", { mode: "number" }).notNull().default(0),
  returnsAt: bigint("returns_at", { mode: "number" }),
  /** Kuşatma varsa bitişi sabitlenir; cron çağrı sayısı sonuca etki etmez. */
  siegeEndsAt: bigint("siege_ends_at", { mode: "number" }),
  /** Ablukanın son kesin hesaplandığı an; ikmal kesintisi cron sıklığından bağımsızdır. */
  blockadeSettledAt: bigint("blockade_settled_at", { mode: "number" }),
  /** Hedefin yaşadığı on iki saatlik açık sınır baskısı sayısı. */
  blockadePressure: integer("blockade_pressure").notNull().default(0),
  /** Kuşatma başına tek huruç: koşullu güncelleme eşzamanlı çift emri kapatır. */
  sallyAt: bigint("sally_at", { mode: "number" }),
  /** Savunanın geri çekilen orduya yaptığı tek takip hamlesi. */
  pursuitAt: bigint("pursuit_at", { mode: "number" }),
  /** Bu seferden doğan tek barış belgesinin mühür zamanı. */
  peaceOfferAt: bigint("peace_offer_at", { mode: "number" }),
  /** Sınır tehdidine halkın ilk tepkisi; savunma morali buradan türer. */
  defenderCivicResponse: text("defender_civic_response", { enum: ["support", "watch", "pressure"] }).notNull().default("watch"),
  defenderMoraleBonus: integer("defender_morale_bonus").notNull().default(0),
  /** Kral seferdeyse saha sonucu kendi tarafına haberci beklemeden ulaşır. */
  kingLeads: boolean("king_leads").notNull().default(false),
  attackerSupportMorale: integer("attacker_support_morale").notNull().default(0),
  defenderSupportMorale: integer("defender_support_morale").notNull().default(0),
  warPoints: integer("war_points").notNull().default(0),
  outcome: text("outcome", { enum: ["attacker", "defender", "draw"] }),
  /** Savaşta kazanılan, yalnız dönüşte ambara giren kaynaklar. */
  loot: text("loot").notNull().default("{}"),
  resolvedAt: bigint("resolved_at", { mode: "number" }),
  /** Koşullu durum geçişleri için değişen sürüm; istemcinin yazabileceği alan değildir. */
  revision: integer("revision").notNull().default(1),
}, (table) => [
  index("idx_wars_channel_status").on(table.channelId, table.status),
  index("idx_wars_attacker_status").on(table.attackerId, table.status),
  index("idx_wars_defender_status").on(table.defenderId, table.status),
  index("idx_wars_pair_finished").on(table.attackerId, table.defenderId, table.resolvedAt),
  // Aynı Krallık eşzamanlı iki seferde aynı birliği kullanamaz. Birden fazla
  // cephe daha sonra ayrı garnizon rezerviyle açılabilir; ilk sürüm yarışa
  // açık bir "aynı orduyu iki kez yolla" yolunu hiç oluşturmuyor.
  uniqueIndex("idx_wars_attacker_active").on(table.attackerId).where(sql`${table.status} in ('gathering','marching','engaged','siege','blockade','returning')`),
  uniqueIndex("idx_wars_defender_active").on(table.defenderId).where(sql`${table.status} in ('gathering','marching','engaged','siege','blockade','returning')`),
]);

/** Seferde kalan kuvvet ve ayrılan erzak; iki taraf için birer satır. */
export const warArmies = pgTable("war_armies", {
  warId: text("war_id").notNull().references(() => wars.id, { onDelete: "cascade" }),
  side: text("side", { enum: ["attacker", "defender"] }).notNull(),
  /** Birlik tipleri yalnız `engine/units.ts` katalog anahtarlarıdır; API yazmadan önce doğrular. */
  units: text("units").notNull(),
  supply: integer("supply").notNull().default(0),
  initialSupply: integer("initial_supply").notNull().default(0),
  morale: integer("morale").notNull().default(70),
  approach: text("approach", { enum: ["cautious", "balanced", "intense", "hard_response"] }).notNull().default("balanced"),
  withdrawThreshold: integer("withdraw_threshold").notNull().default(50),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => [primaryKey({ columns: [table.warId, table.side] })]);

/** Tarafsız krallıkların savaş alanına gönderdiği, zaman alan destek hareketleri. */
export const warSupports = pgTable("war_supports", {
  id: text("id").primaryKey(),
  warId: text("war_id").notNull().references(() => wars.id, { onDelete: "cascade" }),
  supporterId: text("supporter_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  side: text("side", { enum: ["attacker", "defender"] }).notNull(),
  /** İkmal, savunmaya gönüllü birlik veya saldırana geçiş hakkı. */
  kind: text("kind", { enum: ["supply", "troops", "passage"] }).notNull().default("supply"),
  food: integer("food").notNull(),
  /** Birlik desteğinde yalnız hayatta kalan birlikler tutulur; dönüş bununla hesaplanır. */
  units: text("units").notNull().default("{}"),
  status: text("status", { enum: ["en_route", "delivered", "late", "returned"] }).notNull().default("en_route"),
  sentAt: bigint("sent_at", { mode: "number" }).notNull(),
  arrivesAt: bigint("arrives_at", { mode: "number" }).notNull(),
  deliveredAt: bigint("delivered_at", { mode: "number" }),
  returnedAt: bigint("returned_at", { mode: "number" }),
}, (table) => [
  index("idx_war_supports_arrival").on(table.status, table.arrivesAt),
  index("idx_war_supports_supporter").on(table.supporterId, table.sentAt),
]);

/** Başkentten sahaya giden, varış anında uygulanan Kral emirleri. */
export const warCommands = pgTable("war_commands", {
  id: text("id").primaryKey(),
  warId: text("war_id").notNull().references(() => wars.id, { onDelete: "cascade" }),
  issuerId: text("issuer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["advance", "hold", "withdraw"] }).notNull(),
  status: text("status", { enum: ["en_route", "applied", "late"] }).notNull().default("en_route"),
  sentAt: bigint("sent_at", { mode: "number" }).notNull(),
  arrivesAt: bigint("arrives_at", { mode: "number" }).notNull(),
  appliedAt: bigint("applied_at", { mode: "number" }),
}, (table) => [
  index("idx_war_commands_arrival").on(table.status, table.arrivesAt),
  index("idx_war_commands_issuer").on(table.issuerId, table.sentAt),
]);

/** Çevrimdışı savunma için Kralın önceden mühürlediği varsayılan yaklaşım. */
export const warDefenses = pgTable("war_defenses", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  doctrine: text("doctrine", { enum: ["cautious", "balanced", "hard_response"] }).notNull().default("balanced"),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.channelId] })]);

/** Savaşın doğrulanabilir kronolojisi. Aynı aşama iki kez yazılamaz. */
export const warEvents = pgTable("war_events", {
  warId: text("war_id").notNull().references(() => wars.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  at: bigint("at", { mode: "number" }).notNull(),
  /** Ayrıntıların iki saraya haberciyle ulaşacağı an. 0 eski olayları görünür tutar. */
  visibleAt: bigint("visible_at", { mode: "number" }).notNull().default(0),
}, (table) => [primaryKey({ columns: [table.warId, table.sequence] })]);

/** İki tarafa ayrı okunma damgası taşıyan, değişmez savaş haberleri. */
export const warReports = pgTable("war_reports", {
  id: text("id").primaryKey(),
  warId: text("war_id").notNull().references(() => wars.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  summary: text("summary").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  /** Rapor yazıldığı an değil, habercinin Krala ulaştığı an okunur. */
  availableAt: bigint("available_at", { mode: "number" }).notNull().default(0),
  readAt: bigint("read_at", { mode: "number" }),
}, (table) => [
  uniqueIndex("idx_war_reports_once").on(table.warId, table.userId, table.kind),
  index("idx_war_reports_user").on(table.userId, table.readAt, table.createdAt),
  index("idx_war_reports_delivery").on(table.userId, table.availableAt),
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
  /** Saha ateşkesi bu masadan doğduysa imza, ilgili seferi dönüşe geçirir. */
  warId: text("war_id").references(() => wars.id, { onDelete: "set null" }),
  initiatorId: text("initiator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetId: text("target_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  topic: text("topic", { enum: ["tribute", "non_aggression", "alliance", "passage", "ultimatum", "mercenary"] }).notNull(),
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
  index("idx_negotiations_war").on(table.warId),
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
  topic: text("topic", { enum: ["tribute", "non_aggression", "alliance", "passage", "ultimatum", "mercenary"] }).notNull(),
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

/**
 * KRALLIK İLİŞKİLERİ — oyuncunun karşı krallıkla uzun vadeli diplomatik
 * duruşu. Bu, itibarın (channel genelindeki ün) yerini tutmaz; savaşta verilen
 * destek, yapılan anlaşma ve sonraki diplomasi için çift taraflı hafızadır.
 */
export const diplomaticRelations = pgTable("diplomatic_relations", {
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  sourceUserId: text("source_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetUserId: text("target_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  standing: integer("standing").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.sourceUserId, table.targetUserId] }),
  index("idx_diplomatic_relations_source").on(table.channelId, table.sourceUserId),
]);

/**
 * KİRALIK BİRLİK SÖZLEŞMELERİ — birlik sayısı kiracının kaydında görünür,
 * fakat vatandaşlar kiralayan krallığa aittir. Tek aktif kiracı kısıtı,
 * toplu `units.mercenary` sayısının hangi sözleşmeye ait olduğunun kaybolmasını
 * önler; sözleşme bittiğinde hayatta kalanların tamamı doğru nüfusa döner.
 */
export const mercenaryContracts = pgTable("mercenary_contracts", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  agreementId: text("agreement_id").notNull().references(() => agreements.id, { onDelete: "cascade" }),
  lessorId: text("lessor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  renterId: text("renter_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  count: integer("count").notNull(),
  fee: integer("fee").notNull(),
  startedAt: bigint("started_at", { mode: "number" }).notNull(),
  endsAt: bigint("ends_at", { mode: "number" }).notNull(),
  status: text("status", { enum: ["active", "completed", "cancelled"] }).notNull().default("active"),
  returnedAt: bigint("returned_at", { mode: "number" }),
}, (table) => [
  uniqueIndex("idx_mercenary_contract_agreement").on(table.agreementId),
  uniqueIndex("idx_mercenary_contract_renter_active").on(table.renterId).where(sql`${table.status} = 'active'`),
  index("idx_mercenary_contract_due").on(table.status, table.endsAt),
  index("idx_mercenary_contract_lessor").on(table.lessorId, table.status),
]);
