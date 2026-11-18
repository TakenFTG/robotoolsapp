CREATE TABLE `TeamScreenings` (
	`teamId` text PRIMARY KEY NOT NULL,
	`note` text NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `Teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `Judges` ADD `isLeadJudge` integer DEFAULT false NOT NULL;