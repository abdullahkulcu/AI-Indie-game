ALTER TABLE "council_briefings" ADD COLUMN IF NOT EXISTS "discussion" text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE "council_briefings" ADD COLUMN IF NOT EXISTS "session_stage" text NOT NULL DEFAULT 'concluded';
--> statement-breakpoint
ALTER TABLE "council_briefings" ADD COLUMN IF NOT EXISTS "session_next_at" bigint;
--> statement-breakpoint
ALTER TABLE "council_briefings" ADD COLUMN IF NOT EXISTS "session_ends_at" bigint;
--> statement-breakpoint
ALTER TABLE "council_meeting_history" ADD COLUMN IF NOT EXISTS "discussion" text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE "council_meeting_history" ADD COLUMN IF NOT EXISTS "session_stage" text NOT NULL DEFAULT 'concluded';
