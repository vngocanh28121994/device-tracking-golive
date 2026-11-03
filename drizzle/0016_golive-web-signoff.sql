CREATE TABLE `golive_web_signoffs` (
	`release_id` text NOT NULL,
	`user_id` text NOT NULL,
	`signed_at` text NOT NULL,
	PRIMARY KEY(`release_id`, `user_id`)
);
