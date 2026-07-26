-- AlterEnum
ALTER TYPE "MediaProvider" ADD VALUE 'LOCAL';

-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "manuallyReleasedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "originalFilename" TEXT;
