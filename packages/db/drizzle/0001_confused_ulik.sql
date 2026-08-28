PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_rate_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer,
	`last_request` integer
);
--> statement-breakpoint
INSERT INTO `__new_rate_limit`("id", "key", "count", "last_request") SELECT "id", "key", "count", "last_request" FROM `rate_limit`;--> statement-breakpoint
DROP TABLE `rate_limit`;--> statement-breakpoint
ALTER TABLE `__new_rate_limit` RENAME TO `rate_limit`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limit_key_unique` ON `rate_limit` (`key`);