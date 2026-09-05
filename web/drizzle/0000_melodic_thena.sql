CREATE TABLE `connections` (
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`client_id` text,
	`secret_cipher` text,
	`token_cipher` text,
	`expires_at` integer,
	`status` text DEFAULT 'not_connected' NOT NULL,
	`last_sync` text,
	`last_error` text,
	`summary` text,
	`sync_until` integer DEFAULT 0 NOT NULL,
	`revision` text NOT NULL,
	PRIMARY KEY(`user_id`, `provider`)
);
--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`revision` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_entries` (
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`record_id` text NOT NULL,
	`day` text NOT NULL,
	`time` text NOT NULL,
	`type` text NOT NULL,
	`amount` real NOT NULL,
	`title` text NOT NULL,
	PRIMARY KEY(`user_id`, `provider`, `record_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_source_entries_user_day` ON `source_entries` (`user_id`,`day`);--> statement-breakpoint
CREATE TABLE `sync_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`preferences` text NOT NULL
);
