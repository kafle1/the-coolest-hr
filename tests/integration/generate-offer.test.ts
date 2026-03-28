// @vitest-environment node

import { ApplicationStatus, OfferStatus, RoleStatus } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/service", () => ({
  getAiService: () => ({
    generateOfferLetter: vi.fn().mockResolvedValue({
      subjectLine: "AI Product Operator Offer Letter",
      bodyText: "We are excited to offer you the role.",
    }),
  }),
}));

vi.mock("@/lib/email/service", () => ({
  sendApplicationConfirmation: vi.fn(),
  sendInterviewConfirmationEmail: vi.fn(),
  sendSchedulingOptionsEmail: vi.fn(),
  sendSchedulingNudgeEmail: vi.fn(),
  sendInterviewRescheduleAlert: vi.fn(),
  sendOfferSignedAlert: vi.fn(),
}));

import { generateOffer } from "@/lib/applications/service";
import { prisma } from "@/lib/prisma/client";
import { disconnectDatabase, resetDatabase } from "@/tests/helpers/db";

describe("generateOffer", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it("moves interview-completed candidates through draft into sent when sendNow is true", async () => {
    const role = await prisma.role.create({
      data: {
        slug: "generate-offer-role",
        title: "AI Product Operator",
        team: "Product",
        location: "Nepal",
        remoteStatus: "Remote",
        experienceLevel: "Senior",
        summary: "Offer role",
        responsibilities: ["Ship tools"],
        requirements: ["Write code"],
        status: RoleStatus.OPEN,
      },
    });
    const application = await prisma.application.create({
      data: {
        fullName: "Offer Pipeline Candidate",
        email: "offer-pipeline@example.com",
        linkedinUrl: "https://linkedin.com/in/offer-pipeline",
        status: ApplicationStatus.INTERVIEW_COMPLETED,
        roleId: role.id,
      },
    });

    const offer = await generateOffer(application.id, {
      jobTitle: role.title,
      startDate: new Date("2026-04-15T00:00:00.000Z"),
      baseSalary: "NPR 300,000 / month",
      reportingManager: "Jordan Lee",
      sendNow: true,
    });

    const refreshedApplication = await prisma.application.findUniqueOrThrow({
      where: { id: application.id },
    });
    const statusHistory = await prisma.statusHistory.findMany({
      where: { applicationId: application.id },
      orderBy: { createdAt: "asc" },
    });

    expect(offer.status).toBe(OfferStatus.SENT);
    expect(refreshedApplication.status).toBe(ApplicationStatus.OFFER_SENT);
    expect(statusHistory.map((entry) => entry.toStatus)).toEqual([
      ApplicationStatus.OFFER_DRAFT,
      ApplicationStatus.OFFER_SENT,
    ]);
  });
});
