CREATE TABLE `daily_checks` (
	`date` text NOT NULL,
	`device_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`holder` text NOT NULL,
	`condition` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`checked_by` text NOT NULL,
	`checked_at` text NOT NULL,
	PRIMARY KEY(`date`, `device_id`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text DEFAULT '' NOT NULL,
	`category` text DEFAULT 'Khác' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`holder` text DEFAULT 'Kho thiết bị' NOT NULL,
	`condition` text DEFAULT 'Tốt' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);
