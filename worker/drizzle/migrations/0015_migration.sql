DROP TABLE `JudgeAdvisorUnlocks`;--> statement-breakpoint
ALTER TABLE `JudgeAdvisors` DROP COLUMN `pinHash`;--> statement-breakpoint
ALTER TABLE `JudgeAdvisors` DROP COLUMN `pinSalt`;--> statement-breakpoint
ALTER TABLE `JudgeAdvisors` DROP COLUMN `pinIterations`;--> statement-breakpoint
ALTER TABLE `JudgeAdvisors` DROP COLUMN `pinFailedAttempts`;--> statement-breakpoint
ALTER TABLE `JudgeAdvisors` DROP COLUMN `pinLockedUntil`;