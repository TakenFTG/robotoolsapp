ALTER TABLE `JudgeAdvisors` ADD `pinHash` text;--> statement-breakpoint
ALTER TABLE `JudgeAdvisors` ADD `pinSalt` text;--> statement-breakpoint
ALTER TABLE `JudgeAdvisors` ADD `pinIterations` integer;--> statement-breakpoint
ALTER TABLE `JudgeAdvisors` ADD `pinFailedAttempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `JudgeAdvisors` ADD `pinLockedUntil` integer;
