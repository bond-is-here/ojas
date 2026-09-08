ALTER TABLE `connections` ADD `credential_source` text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE `oauth_states` ADD `client_id` text;--> statement-breakpoint
ALTER TABLE `oauth_states` ADD `credential_source` text;