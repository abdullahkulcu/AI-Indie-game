ALTER TABLE "shared_mine_workers" ADD COLUMN "pending_ore" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shared_mine_workers" ADD COLUMN "delivered_ore" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shared_mine_workers" ADD COLUMN "last_delivery_at" bigint DEFAULT 0 NOT NULL;