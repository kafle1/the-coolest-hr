ALTER TABLE "Interview"
ADD COLUMN "notetakerProvider" TEXT,
ADD COLUMN "notetakerMeetingId" TEXT,
ADD COLUMN "notetakerState" TEXT,
ADD COLUMN "notetakerRequestedAt" TIMESTAMP(3);
