CREATE TABLE `device_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` text NOT NULL,
	`action` text NOT NULL,
	`from_holder` text,
	`to_holder` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`actor_email` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `device_movements_device_id_id_idx` ON `device_movements` (`device_id`,`id`);