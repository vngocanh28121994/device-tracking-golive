CREATE TABLE `golive_builds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`release_id` text NOT NULL,
	`build_number` text NOT NULL,
	`pushed_at` text NOT NULL,
	`pushed_by` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `golive_builds_release_id_idx` ON `golive_builds` (`release_id`);--> statement-breakpoint
CREATE TABLE `golive_risk_acceptances` (
	`ticket_id` integer NOT NULL,
	`phase` text NOT NULL,
	`release_id` text NOT NULL,
	`reason` text NOT NULL,
	`accepted_by` text NOT NULL,
	`accepted_at` text NOT NULL,
	PRIMARY KEY(`ticket_id`, `phase`)
);
--> statement-breakpoint
CREATE INDEX `golive_risk_release_id_idx` ON `golive_risk_acceptances` (`release_id`);--> statement-breakpoint
CREATE TABLE `golive_ticket_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` integer NOT NULL,
	`release_id` text NOT NULL,
	`phase` text NOT NULL,
	`from_status` text NOT NULL,
	`to_status` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`build_id` integer,
	`actor_user_id` text,
	`actor_name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `golive_ticket_events_release_id_idx` ON `golive_ticket_events` (`release_id`);--> statement-breakpoint
ALTER TABLE `golive_device_checks` ADD `build_id` integer;--> statement-breakpoint
ALTER TABLE `golive_releases` ADD `signoff_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `golive_ticket_devices` ADD `waived_at` text;--> statement-breakpoint
ALTER TABLE `golive_ticket_devices` ADD `waived_by` text;--> statement-breakpoint
ALTER TABLE `golive_ticket_devices` ADD `waived_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `golive_tickets` ADD `app_build_id` integer;--> statement-breakpoint
-- Backfill: every release already pushed gets one build with no number; its results keep a null build and read "—".
INSERT INTO golive_builds (release_id, build_number, pushed_at, pushed_by)
  SELECT id, '', app_pushed_at, COALESCE(app_pushed_by, '') FROM golive_releases WHERE app_pushed_at IS NOT NULL;
