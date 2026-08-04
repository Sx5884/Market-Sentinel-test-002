-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "deduplicationEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showToastAlerts" BOOLEAN NOT NULL DEFAULT true;
