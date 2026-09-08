CREATE TABLE `apple_import_snapshots` (
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`exported_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `type`)
);
