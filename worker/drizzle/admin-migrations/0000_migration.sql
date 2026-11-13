CREATE TABLE `AdminLoginThrottle` (
	`id` text PRIMARY KEY NOT NULL,
	`failedAttempts` integer DEFAULT 0 NOT NULL,
	`lockedUntil` integer
);
--> statement-breakpoint
CREATE TABLE `AdminSessions` (
	`tokenHash` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`expiresAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `RegisteredRooms` (
	`roomId` text PRIMARY KEY NOT NULL,
	`eventName` text NOT NULL,
	`program` text NOT NULL,
	`eventGradeLevel` text NOT NULL,
	`divisionId` integer,
	`robotEventsSku` text,
	`accessControlEnabled` integer DEFAULT true NOT NULL,
	`groupId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
