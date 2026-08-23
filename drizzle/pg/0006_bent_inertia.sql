CREATE TABLE "populace_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"user_id" text,
	"persona" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"iv" text NOT NULL,
	"key_version" text DEFAULT 'v1' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "populace_credentials" ADD CONSTRAINT "populace_credentials_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "populace_credentials" ADD CONSTRAINT "populace_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "populace_credentials" ADD CONSTRAINT "populace_credentials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_populace_credentials_default" ON "populace_credentials" USING btree ("channel_id") WHERE "populace_credentials"."user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_populace_credentials_kingdom" ON "populace_credentials" USING btree ("channel_id","user_id") WHERE "populace_credentials"."user_id" is not null;