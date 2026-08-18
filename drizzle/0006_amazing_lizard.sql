CREATE TABLE `pending_decisions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`reasons` text NOT NULL,
	`risk_level` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
