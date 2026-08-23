CREATE TABLE "shared_mine_finds" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"mine_id" text NOT NULL,
	"depleted_at" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"claimed_by" text,
	"claimed_at" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shared_mine_finds" ADD CONSTRAINT "shared_mine_finds_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_mine_finds" ADD CONSTRAINT "shared_mine_finds_mine_id_shared_mines_id_fk" FOREIGN KEY ("mine_id") REFERENCES "public"."shared_mines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_mine_finds" ADD CONSTRAINT "shared_mine_finds_claimed_by_users_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_shared_mine_finds_mine" ON "shared_mine_finds" USING btree ("mine_id","status");