CREATE TABLE `AuditLog` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` integer NOT NULL,
	`actorRole` text,
	`actorId` text,
	`actorName` text,
	`verified` integer NOT NULL,
	`deviceId` text NOT NULL,
	`deviceName` text NOT NULL,
	`action` text NOT NULL,
	`teamId` text,
	`teamNumber` text,
	`awardName` text,
	`details` text NOT NULL,
	`coalesceKey` text
);
--> statement-breakpoint
CREATE INDEX `audit_log_actorId` ON `AuditLog` (`actorId`);--> statement-breakpoint
CREATE INDEX `audit_log_teamId` ON `AuditLog` (`teamId`);--> statement-breakpoint
CREATE INDEX `audit_log_coalesceKey` ON `AuditLog` (`coalesceKey`);