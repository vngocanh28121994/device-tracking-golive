ALTER TABLE `golive_tickets` ADD `failed_at` text;--> statement-breakpoint
ALTER TABLE `golive_tickets` ADD `failed_by` text;--> statement-breakpoint
ALTER TABLE `golive_tickets` ADD `failed_reason` text DEFAULT '' NOT NULL;