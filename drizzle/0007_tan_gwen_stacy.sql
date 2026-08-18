CREATE TABLE `standing_orders` (
	`user_id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`instruction` text NOT NULL,
	`autonomy` text DEFAULT 'ask' NOT NULL,
	`status` text DEFAULT 'pending_approval' NOT NULL,
	`max_actions_per_wake` integer DEFAULT 1 NOT NULL,
	`daily_action_cap` integer DEFAULT 8 NOT NULL,
	`actions_today` integer DEFAULT 0 NOT NULL,
	`day_started_at` integer NOT NULL,
	`last_run_at` integer,
	`last_outcome` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
