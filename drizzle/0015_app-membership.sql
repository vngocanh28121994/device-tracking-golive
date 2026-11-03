CREATE TABLE `members` (
	`email` text PRIMARY KEY NOT NULL,
	`added_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO members (email, added_by, created_at) VALUES
('vngocanh281219941@gmail.com', 'migration', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('chinhvu5008@gmail.com', 'migration', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('hainguyenthe1999@gmail.com', 'migration', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('hajunmylee@gmail.com', 'migration', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('nhungvu214@gmail.com', 'migration', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('toan.phung@outlook.com', 'migration', strftime('%Y-%m-%dT%H:%M:%fZ','now')),
('trungphongptit@gmail.com', 'migration', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
