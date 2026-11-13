CREATE TABLE `GroupAdvisorUnlocks` (
	`groupAdvisorId` text NOT NULL,
	`deviceId` text NOT NULL,
	`expiresAt` integer NOT NULL,
	PRIMARY KEY(`groupAdvisorId`, `deviceId`),
	FOREIGN KEY (`groupAdvisorId`) REFERENCES `GroupAdvisors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `GroupAdvisors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT 'Judge Advisor' NOT NULL,
	`authToken` text NOT NULL,
	`pinHash` text,
	`pinSalt` text,
	`pinIterations` integer,
	`pinFailedAttempts` integer DEFAULT 0 NOT NULL,
	`pinLockedUntil` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_advisors_authToken` ON `GroupAdvisors` (`authToken`);--> statement-breakpoint
CREATE TABLE `GroupMetadata` (
	`groupId` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `GroupRooms` (
	`roomId` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`position` integer NOT NULL
);
