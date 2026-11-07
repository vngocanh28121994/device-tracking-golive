ALTER TABLE `golive_releases` ADD `app_pushed_at` text;--> statement-breakpoint
ALTER TABLE `golive_releases` ADD `app_pushed_by` text;--> statement-breakpoint
-- Releases created before this step keep their old behaviour: the app phase opens as soon as web is done.
UPDATE `golive_releases` SET `app_pushed_at` = `created_at`;
