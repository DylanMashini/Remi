-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CAREGIVER', 'WEARER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'CAREGIVER';
