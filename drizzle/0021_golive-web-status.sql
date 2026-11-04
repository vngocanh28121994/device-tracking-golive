ALTER TABLE `golive_tickets` ADD `web_status` text;--> statement-breakpoint
ALTER TABLE `golive_tickets` ADD `web_at` text;--> statement-breakpoint
ALTER TABLE `golive_tickets` ADD `web_by` text;--> statement-breakpoint
ALTER TABLE `golive_tickets` ADD `web_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `golive_tickets` ADD `web_notified` integer DEFAULT false NOT NULL;