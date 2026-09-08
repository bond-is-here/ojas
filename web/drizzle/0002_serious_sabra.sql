CREATE TABLE `manual_entries` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`day` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_manual_entries_user_day` ON `manual_entries` (`user_id`,`day`);--> statement-breakpoint
CREATE TABLE `workspace_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`goals` text NOT NULL,
	`demo` integer DEFAULT 0 NOT NULL,
	`motion` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_receipts` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`fingerprint` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
