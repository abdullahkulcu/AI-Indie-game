CREATE TABLE "channel_members" (
	"user_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_members_user_id_channel_id_pk" PRIMARY KEY("user_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"speed" integer DEFAULT 1 NOT NULL,
	"duration_days" integer NOT NULL,
	"max_players" integer NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_saves" (
	"user_id" text PRIMARY KEY NOT NULL,
	"game_state" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intel_defenses" (
	"user_id" text PRIMARY KEY NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"active_until" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intel_missions" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"source_user_id" text NOT NULL,
	"target_user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"success_chance" integer NOT NULL,
	"detection_chance" integer NOT NULL,
	"completes_at" bigint NOT NULL,
	"report" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "llm_credentials" (
	"user_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"iv" text NOT NULL,
	"key_version" text DEFAULT 'v1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_decisions" (
	"user_id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"reasons" text NOT NULL,
	"risk_level" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"bucket" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"window_start" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_mine_workers" (
	"mine_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workers" integer DEFAULT 5 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_mine_workers_mine_id_user_id_pk" PRIMARY KEY("mine_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "shared_mines" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"name" text DEFAULT 'Ortak Demir Damarı' NOT NULL,
	"ore_remaining" integer DEFAULT 100000 NOT NULL,
	"extracted_ore" integer DEFAULT 0 NOT NULL,
	"last_tick_at" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "standing_orders" (
	"user_id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"instruction" text NOT NULL,
	"autonomy" text DEFAULT 'ask' NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"max_actions_per_wake" integer DEFAULT 1 NOT NULL,
	"daily_action_cap" integer DEFAULT 8 NOT NULL,
	"actions_today" integer DEFAULT 0 NOT NULL,
	"day_started_at" bigint NOT NULL,
	"last_run_at" bigint,
	"last_outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'player' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intel_defenses" ADD CONSTRAINT "intel_defenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intel_missions" ADD CONSTRAINT "intel_missions_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intel_missions" ADD CONSTRAINT "intel_missions_source_user_id_users_id_fk" FOREIGN KEY ("source_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intel_missions" ADD CONSTRAINT "intel_missions_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_credentials" ADD CONSTRAINT "llm_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_decisions" ADD CONSTRAINT "pending_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_mine_workers" ADD CONSTRAINT "shared_mine_workers_mine_id_shared_mines_id_fk" FOREIGN KEY ("mine_id") REFERENCES "public"."shared_mines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_mine_workers" ADD CONSTRAINT "shared_mine_workers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_mines" ADD CONSTRAINT "shared_mines_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_orders" ADD CONSTRAINT "standing_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_channel_members_channel" ON "channel_members" USING btree ("channel_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_channels_slug" ON "channels" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_intel_missions_source_target_pending" ON "intel_missions" USING btree ("source_user_id","target_user_id") WHERE "intel_missions"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_intel_missions_channel" ON "intel_missions" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_shared_mines_channel" ON "shared_mines" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_standing_orders_status" ON "standing_orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_single_admin" ON "users" USING btree ("role") WHERE "users"."role" = 'admin';