ALTER TABLE `golive_tickets` ADD `skip_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `golive_tickets` ADD `skip_notified` integer DEFAULT false NOT NULL;