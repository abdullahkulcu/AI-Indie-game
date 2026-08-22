CREATE TABLE "agitations" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"source_user_id" text NOT NULL,
	"target_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"cost" integer NOT NULL,
	"cost_resource" text DEFAULT 'gold' NOT NULL,
	"sent_at" bigint NOT NULL,
	"completes_at" bigint NOT NULL,
	"pair_window" bigint NOT NULL,
	"settled_at" bigint
);
--> statement-breakpoint
CREATE TABLE "populace_demands" (
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"voice" text DEFAULT 'commons' NOT NULL,
	"text" text NOT NULL,
	"severity" text DEFAULT 'normal' NOT NULL,
	"seen_at" bigint NOT NULL,
	"opened_at" bigint,
	"last_notice_at" bigint,
	CONSTRAINT "populace_demands_user_id_kind_pk" PRIMARY KEY("user_id","kind")
);
--> statement-breakpoint
ALTER TABLE "channel_members" ADD COLUMN "accepts_agitation" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agitations" ADD CONSTRAINT "agitations_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agitations" ADD CONSTRAINT "agitations_source_user_id_users_id_fk" FOREIGN KEY ("source_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agitations" ADD CONSTRAINT "agitations_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "populace_demands" ADD CONSTRAINT "populace_demands_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_agitations_pair_window" ON "agitations" USING btree ("source_user_id","target_user_id","pair_window");--> statement-breakpoint
CREATE INDEX "idx_agitations_pending" ON "agitations" USING btree ("status","completes_at");--> statement-breakpoint
CREATE INDEX "idx_agitations_source" ON "agitations" USING btree ("source_user_id","sent_at");--> statement-breakpoint
CREATE INDEX "idx_agitations_target" ON "agitations" USING btree ("target_user_id","sent_at");