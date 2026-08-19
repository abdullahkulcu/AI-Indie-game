import { sql } from "drizzle-orm";
import { bigint, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("idx_shared_mines_channel").on(table.channelId)]);

export const sharedMineWorkers = pgTable("shared_mine_workers", {
  mineId: text("mine_id").notNull().references(() => sharedMines.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workers: integer("workers").notNull().default(5),
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

// Sabit pencereli hız sınırı sayaçları; tek upsert deyimiyle atomik artar.
export const rateLimits = pgTable("rate_limits", {
  bucket: text("bucket").primaryKey(),
  count: integer("count").notNull().default(1),
  windowStart: bigint("window_start", { mode: "number" }).notNull(),
});
