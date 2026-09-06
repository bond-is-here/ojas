CREATE TABLE `source_workouts` (
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`id` text NOT NULL,
	`day` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`user_id`, `provider`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_source_workouts_user_day` ON `source_workouts` (`user_id`,`day`);--> statement-breakpoint
CREATE TABLE `training_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`preferences` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workout_sessions` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`day` text NOT NULL,
	`status` text NOT NULL,
	`version` integer NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_workout_sessions_user_day` ON `workout_sessions` (`user_id`,`day`);