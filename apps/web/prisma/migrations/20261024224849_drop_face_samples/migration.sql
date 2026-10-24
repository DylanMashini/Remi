-- DropForeignKey
ALTER TABLE "FaceSample" DROP CONSTRAINT "FaceSample_fileId_fkey";

-- DropForeignKey
ALTER TABLE "FaceSample" DROP CONSTRAINT "FaceSample_personId_fkey";

-- DropTable
DROP TABLE "FaceSample";
