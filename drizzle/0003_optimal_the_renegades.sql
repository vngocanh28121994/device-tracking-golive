CREATE TABLE `teams_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`report_date` text NOT NULL,
	`status` text NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`sent_at` text
);
--> statement-breakpoint
CREATE TABLE `teams_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`encrypted_webhook` text,
	`target_label` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);
