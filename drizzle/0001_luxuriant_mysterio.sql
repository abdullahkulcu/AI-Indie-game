CREATE TABLE `channel_members` (
	`user_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`joined_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `channel_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`speed` integer DEFAULT 1 NOT NULL,
	`duration_days` integer NOT NULL,
	`max_players` integer NOT NULL,
	`starts_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`ends_at` text,
	`created_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_channels_slug` ON `channels` (`slug`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'player' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_login_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
INSERT INTO `channels` (`id`,`name`,`slug`,`status`,`speed`,`duration_days`,`max_players`,`starts_at`,`ends_at`) VALUES
('standard','Standart Sezon I','standart-sezon-1','active',1,84,300,CURRENT_TIMESTAMP,datetime('now','+84 days'));--> statement-breakpoint
INSERT INTO `channels` (`id`,`name`,`slug`,`status`,`speed`,`duration_days`,`max_players`,`starts_at`,`ends_at`) VALUES
('frontier','Sınır Boyu','sinir-boyu','active',4,28,120,CURRENT_TIMESTAMP,datetime('now','+28 days'));--> statement-breakpoint
INSERT INTO `channels` (`id`,`name`,`slug`,`status`,`speed`,`duration_days`,`max_players`,`starts_at`,`ends_at`) VALUES
('rapid','Hızlı Taç','hizli-tac','active',24,7,80,CURRENT_TIMESTAMP,datetime('now','+7 days'));
