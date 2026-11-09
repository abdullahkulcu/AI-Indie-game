CREATE TABLE "migrations" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"source_user_id" text NOT NULL,
	"count" integer NOT NULL,
	"sent_at" bigint NOT NULL,
	"completes_at" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"settled_at" bigint
);
--> statement-breakpoint
ALTER TABLE "migrations" ADD CONSTRAINT "migrations_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migrations" ADD CONSTRAINT "migrations_source_user_id_users_id_fk" FOREIGN KEY ("source_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_migrations_pending" ON "migrations" USING btree ("status","completes_at");--> statement-breakpoint
CREATE INDEX "idx_migrations_source" ON "migrations" USING btree ("source_user_id","sent_at");