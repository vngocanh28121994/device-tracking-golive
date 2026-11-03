CREATE TABLE `golive_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `golive_tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`release_id` text NOT NULL,
	`issue_key` text NOT NULL,
	`summary` text NOT NULL,
	`assignee` text DEFAULT '' NOT NULL,
	`assignee_user_id` text,
	`status` text DEFAULT 'To Do' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `golive_releases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `golive_tickets_release_id_idx` ON `golive_tickets` (`release_id`);