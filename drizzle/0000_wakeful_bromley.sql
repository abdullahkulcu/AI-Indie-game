CREATE TABLE `game_saves` (
	`user_id` text PRIMARY KEY NOT NULL,
	`game_state` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
