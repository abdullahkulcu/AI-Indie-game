import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["player", "admin"] }).notNull().default("player"),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastLoginAt: text("last_login_at"),
}, (table) => [uniqueIndex("idx_users_email").on(table.email), uniqueIndex("idx_users_single_admin").on(table.role).where(sql`${table.role} = 'admin'`)]);

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const channels = sqliteTable("channels", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  speed: integer("speed").notNull().default(1),
  durationDays: integer("duration_days").notNull(),
  maxPlayers: integer("max_players").notNull(),
  startsAt: text("starts_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  endsAt: text("ends_at"),
  createdBy: text("created_by").references(() => users.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_channels_slug").on(table.slug)]);

export const channelMembers = sqliteTable("channel_members", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  joinedAt: text("joined_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.userId, table.channelId] })]);

export const gameSaves = sqliteTable("game_saves", {
  userId: text("user_id").primaryKey(),
  gameState: text("game_state").notNull(),
  revision: integer("revision").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const llmCredentials = sqliteTable("llm_credentials", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["openai", "anthropic"] }).notNull(),
  model: text("model").notNull(),
  encryptedKey: text("encrypted_key").notNull(),
  iv: text("iv").notNull(),
  keyVersion: text("key_version").notNull().default("v1"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const intelDefenses = sqliteTable("intel_defenses", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  level: integer("level").notNull().default(1),
  activeUntil: integer("active_until").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const intelMissions = sqliteTable("intel_missions", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  sourceUserId: text("source_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  targetUserId: text("target_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["pending", "succeeded", "failed", "detected"] }).notNull().default("pending"),
  successChance: integer("success_chance").notNull(),
  detectionChance: integer("detection_chance").notNull(),
  completesAt: integer("completes_at").notNull(),
  report: text("report"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  resolvedAt: text("resolved_at"),
}, (table) => [
  uniqueIndex("idx_intel_missions_source_target_pending").on(table.sourceUserId, table.targetUserId).where(sql`${table.status} = 'pending'`),
]);

export const sharedMines = sqliteTable("shared_mines", {
  id: text("id").primaryKey(),
  channelId: text("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Ortak Demir Damarı"),
  oreRemaining: integer("ore_remaining").notNull().default(100000),
  extractedOre: integer("extracted_ore").notNull().default(0),
  lastTickAt: integer("last_tick_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_shared_mines_channel").on(table.channelId)]);

export const sharedMineWorkers = sqliteTable("shared_mine_workers", {
  mineId: text("mine_id").notNull().references(() => sharedMines.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workers: integer("workers").notNull().default(5),
  joinedAt: text("joined_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.mineId, table.userId] })]);

// Sabit pencereli hız sınırı sayaçları. `bucket` = "<kapsam>:<kimlik>" (örn. "login:ip:1.2.3.4").
// Sayaç tek bir upsert deyimiyle artırıldığı için eşzamanlı isteklerde atomiktir.
export const rateLimits = sqliteTable("rate_limits", {
  bucket: text("bucket").primaryKey(),
  count: integer("count").notNull().default(1),
  windowStart: integer("window_start").notNull(),
});
