import { prisma } from "@/lib/prisma/client";

export async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "EmailLog",
      "OnboardingEvent",
      "Offer",
      "Feedback",
      "Transcript",
      "Interview",
      "InterviewSlotHold",
      "InterviewPlan",
      "ResearchProfile",
      "ScreeningResult",
      "ResumeAsset",
      "StatusHistory",
      "Application",
      "Role"
    RESTART IDENTITY CASCADE;
  `);
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
}
