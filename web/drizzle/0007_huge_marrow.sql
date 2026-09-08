CREATE TABLE `provider_request_budget` (
	`provider` text NOT NULL,
	`client_id_hash` text NOT NULL,
	`blocked_until` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`provider`, `client_id_hash`)
);
--> statement-breakpoint
CREATE TABLE `provider_request_ledger` (
	`reservation_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`client_id_hash` text NOT NULL,
	`reserved_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_provider_request_ledger_key_time` ON `provider_request_ledger` (`provider`,`client_id_hash`,`reserved_at`);