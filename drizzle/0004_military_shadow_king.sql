CREATE TABLE `intel_defenses` (
	`user_id` text PRIMARY KEY NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`active_until` integer NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `intel_missions` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`source_user_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`success_chance` integer NOT NULL,
	`detection_chance` integer NOT NULL,
	`completes_at` integer NOT NULL,
	`report` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_intel_missions_source_target_pending` ON `intel_missions` (`source_user_id`,`target_user_id`) WHERE "intel_missions"."status" = 'pending';--> statement-breakpoint
CREATE TABLE `shared_mine_workers` (
	`mine_id` text NOT NULL,
	`user_id` text NOT NULL,
	`workers` integer DEFAULT 5 NOT NULL,
	`joined_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`mine_id`, `user_id`),
	FOREIGN KEY (`mine_id`) REFERENCES `shared_mines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shared_mines` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`name` text DEFAULT 'Ortak Demir Damarı' NOT NULL,
	`ore_remaining` integer DEFAULT 100000 NOT NULL,
	`extracted_ore` integer DEFAULT 0 NOT NULL,
	`last_tick_at` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_shared_mines_channel` ON `shared_mines` (`channel_id`);