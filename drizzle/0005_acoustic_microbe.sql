ALTER TABLE `devices` ADD `holder_user_id` text;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `avatar_key` text DEFAULT '' NOT NULL;