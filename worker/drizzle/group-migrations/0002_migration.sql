DROP TABLE `GroupAdvisorUnlocks`;--> statement-breakpoint
ALTER TABLE `GroupAdvisors` DROP COLUMN `pinHash`;--> statement-breakpoint
ALTER TABLE `GroupAdvisors` DROP COLUMN `pinSalt`;--> statement-breakpoint
ALTER TABLE `GroupAdvisors` DROP COLUMN `pinIterations`;--> statement-breakpoint
ALTER TABLE `GroupAdvisors` DROP COLUMN `pinFailedAttempts`;--> statement-breakpoint
ALTER TABLE `GroupAdvisors` DROP COLUMN `pinLockedUntil`;