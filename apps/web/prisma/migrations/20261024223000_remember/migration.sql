-- CreateEnum
CREATE TYPE "MemorySource" AS ENUM ('WEARER_VOICE', 'WEARER_TYPED', 'CAREGIVER');

-- AlterEnum
ALTER TYPE "EventType" ADD VALUE 'PRACTICE';

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "calloutText" TEXT NOT NULL,
    "useInCallout" BOOLEAN NOT NULL DEFAULT true,
    "source" "MemorySource" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Memory_personId_createdAt_idx" ON "Memory"("personId", "createdAt");

-- CreateIndex
CREATE INDEX "Memory_patientId_idx" ON "Memory"("patientId");

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
