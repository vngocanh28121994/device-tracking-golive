CREATE TABLE `golive_ticket_failures` (
	`ticket_id` integer NOT NULL,
	`phase` text NOT NULL,
	`release_id` text NOT NULL,
	`failed_by` text NOT NULL,
	`failed_at` text NOT NULL,
	PRIMARY KEY(`ticket_id`, `phase`)
);
--> statement-breakpoint
CREATE INDEX `golive_ticket_failures_release_id_idx` ON `golive_ticket_failures` (`release_id`);--> statement-breakpoint
-- Backfill what the ticket rows still remember: every app mark that is live, and every web phase
-- still failing. Marks already undone before this migration are gone and cannot be recovered.
INSERT OR IGNORE INTO golive_ticket_failures (ticket_id, phase, release_id, failed_by, failed_at)
  SELECT id, 'app', release_id, COALESCE(failed_by, ''), failed_at FROM golive_tickets WHERE failed_at IS NOT NULL;--> statement-breakpoint
INSERT OR IGNORE INTO golive_ticket_failures (ticket_id, phase, release_id, failed_by, failed_at)
  SELECT id, 'web', release_id, COALESCE(web_by, ''), COALESCE(web_at, updated_at) FROM golive_tickets WHERE web_status = 'failed';
