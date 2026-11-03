ALTER TABLE `golive_releases` ADD `source` text DEFAULT 'csv' NOT NULL;--> statement-breakpoint
ALTER TABLE `golive_releases` ADD `fix_version` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `role` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE user_profiles SET role = 'Manager' WHERE email = 'vngocanh281219941@gmail.com';
