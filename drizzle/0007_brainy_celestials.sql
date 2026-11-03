CREATE TABLE `golive_device_checks` (
	`ticket_id` integer NOT NULL,
	`device_id` text NOT NULL,
	`device_name` text NOT NULL,
	`checked_by_user_id` text NOT NULL,
	`checked_at` text NOT NULL,
	PRIMARY KEY(`ticket_id`, `device_id`),
	FOREIGN KEY (`ticket_id`) REFERENCES `golive_tickets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
