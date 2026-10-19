CREATE TABLE `user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `daily_checks` ADD `checked_by_user_id` text;--> statement-breakpoint
ALTER TABLE `daily_checks` ADD `checked_by_email` text;