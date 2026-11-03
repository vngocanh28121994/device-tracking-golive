CREATE TABLE `push_settings` (
	`event` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
