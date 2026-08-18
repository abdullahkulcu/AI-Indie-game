CREATE TABLE "general_ledger" (
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"first_seen_at" bigint NOT NULL,
	"last_seen_at" bigint NOT NULL,
	CONSTRAINT "general_ledger_user_id_kind_pk" PRIMARY KEY("user_id","kind")
);
--> statement-breakpoint
CREATE TABLE "general_requests" (
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"severity" text DEFAULT 'normal' NOT NULL,
	"raised_at" bigint NOT NULL,
	CONSTRAINT "general_requests_user_id_kind_pk" PRIMARY KEY("user_id","kind")
);
--> statement-breakpoint
ALTER TABLE "general_ledger" ADD CONSTRAINT "general_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_requests" ADD CONSTRAINT "general_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;