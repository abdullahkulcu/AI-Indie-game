ALTER TABLE "shared_mine_workers" ADD COLUMN "worker_avg" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shared_mines" ADD COLUMN "influence_user_id" text;--> statement-breakpoint
ALTER TABLE "shared_mines" ADD COLUMN "influence_window" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shared_mines" ADD CONSTRAINT "shared_mines_influence_user_id_users_id_fk" FOREIGN KEY ("influence_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;