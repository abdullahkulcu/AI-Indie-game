CREATE TABLE "agreements" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"negotiation_id" text,
	"topic" text NOT NULL,
	"payer_id" text NOT NULL,
	"payee_id" text NOT NULL,
	"terms" text NOT NULL,
	"started_at" bigint NOT NULL,
	"ends_at" bigint NOT NULL,
	"every_hours" integer DEFAULT 6 NOT NULL,
	"paid_count" integer DEFAULT 0 NOT NULL,
	"missed_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "negotiation_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"negotiation_id" text NOT NULL,
	"side" text NOT NULL,
	"speaker" text DEFAULT 'general' NOT NULL,
	"body" text NOT NULL,
	"at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "negotiations" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"initiator_id" text NOT NULL,
	"target_id" text NOT NULL,
	"topic" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	"proposed" text,
	"proposed_by" text,
	"opened_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"last_turn_at" bigint NOT NULL
);
--> statement-breakpoint
/* 
    Unfortunately in current drizzle-kit version we can't automatically get name for primary key.
    We are working on making it available!

    Meanwhile you can:
        1. Check pk name in your database, by running
            SELECT constraint_name FROM information_schema.table_constraints
            WHERE table_schema = 'public'
                AND table_name = 'standing_orders'
                AND constraint_type = 'PRIMARY KEY';
        2. Uncomment code below and paste pk name manually
        
    Hope to release this update as soon as possible
*/

-- ALTER TABLE "standing_orders" DROP CONSTRAINT "<constraint_name>";--> statement-breakpoint
ALTER TABLE "channel_members" ADD COLUMN "accepts_negotiation" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "standing_orders" ADD COLUMN "id" text PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_payer_id_users_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_payee_id_users_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_messages" ADD CONSTRAINT "negotiation_messages_negotiation_id_negotiations_id_fk" FOREIGN KEY ("negotiation_id") REFERENCES "public"."negotiations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_initiator_id_users_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiations" ADD CONSTRAINT "negotiations_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agreements_payer" ON "agreements" USING btree ("payer_id","status");--> statement-breakpoint
CREATE INDEX "idx_agreements_payee" ON "agreements" USING btree ("payee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_agreements_negotiation" ON "agreements" USING btree ("negotiation_id");--> statement-breakpoint
CREATE INDEX "idx_negotiation_messages_table" ON "negotiation_messages" USING btree ("negotiation_id","at");--> statement-breakpoint
CREATE INDEX "idx_negotiations_initiator" ON "negotiations" USING btree ("initiator_id","status");--> statement-breakpoint
CREATE INDEX "idx_negotiations_target" ON "negotiations" USING btree ("target_id","status");--> statement-breakpoint
CREATE INDEX "idx_standing_orders_user" ON "standing_orders" USING btree ("user_id");