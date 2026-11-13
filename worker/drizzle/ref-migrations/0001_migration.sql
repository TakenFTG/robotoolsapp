CREATE TABLE `LinkedDivisions` (
	`judgesRoomId` text PRIMARY KEY NOT NULL,
	`divisionId` integer,
	`label` text NOT NULL,
	`linkedAt` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `RefMetadata` ADD `linkedGroupId` text;