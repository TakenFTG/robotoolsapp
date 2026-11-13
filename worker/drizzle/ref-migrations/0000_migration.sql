CREATE TABLE `Incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`context` text NOT NULL,
	`teamNumber` text NOT NULL,
	`matchId` integer,
	`matchName` text,
	`skillsRunType` text,
	`ruleCodes` text NOT NULL,
	`severity` text NOT NULL,
	`note` text NOT NULL,
	`private` integer DEFAULT false NOT NULL,
	`authorRefereeId` text,
	`authorName` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `incidents_teamNumber` ON `Incidents` (`teamNumber`);--> statement-breakpoint
CREATE INDEX `incidents_createdAt` ON `Incidents` (`createdAt`);--> statement-breakpoint
CREATE TABLE `RefMetadata` (
	`eventName` text NOT NULL,
	`program` text NOT NULL,
	`robotEventsSku` text,
	`robotEventsEventId` integer,
	`divisions` text NOT NULL,
	`createdAt` integer NOT NULL,
	`lastActivityAt` integer,
	`retentionWarningSentAt` integer
);
--> statement-breakpoint
CREATE TABLE `RefTeams` (
	`number` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`school` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `Referees` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`authToken` text NOT NULL,
	`email` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referees_authToken` ON `Referees` (`authToken`);