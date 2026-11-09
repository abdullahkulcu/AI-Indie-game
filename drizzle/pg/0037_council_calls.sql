ALTER TABLE "council_briefings" ADD COLUMN IF NOT EXISTS "call_requested_at" bigint;
--> statement-breakpoint
ALTER TABLE "council_briefings" ADD COLUMN IF NOT EXISTS "call_due_at" bigint;
--> statement-breakpoint
ALTER TABLE "council_meeting_history" ADD COLUMN IF NOT EXISTS "meeting_type" text NOT NULL DEFAULT 'ordinary';
