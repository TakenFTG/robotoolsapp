CREATE TABLE `JudgeAdvisorUnlocks` (
	`judgeAdvisorId` text NOT NULL,
	`deviceId` text NOT NULL,
	`expiresAt` integer NOT NULL,
	PRIMARY KEY(`judgeAdvisorId`, `deviceId`),
	FOREIGN KEY (`judgeAdvisorId`) REFERENCES `JudgeAdvisors`(`id`) ON UPDATE no action ON DELETE cascade
);
