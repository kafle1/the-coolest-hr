// @vitest-environment node

import {
  ApplicationStatus,
  OnboardingEventType,
  OfferStatus,
  RoleStatus,
} from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { getSlackServiceMock } = vi.hoisted(() => ({
  getSlackServiceMock: vi.fn(),
}));

vi.mock("@/lib/slack/service", () => ({
  getSlackService: getSlackServiceMock,
}));

import { signOffer } from "@/lib/offers/service";
import { prisma } from "@/lib/prisma/client";
import { disconnectDatabase, resetDatabase } from "@/tests/helpers/db";

async function createOfferFixture() {
  const role = await prisma.role.create({
    data: {
      slug: "slack-state-role",
      title: "AI Product Operator",
      team: "Product",
      location: "Nepal",
      remoteStatus: "Remote",
      experienceLevel: "Senior",
      summary: "Slack state role",
      responsibilities: ["Ship tools"],
      requirements: ["Write code"],
      status: RoleStatus.OPEN,
    },
  });

  const application = await prisma.application.create({
    data: {
      fullName: "Slack State Candidate",
      email: "slack-state@example.com",
      linkedinUrl: "https://linkedin.com/in/slack-state",
      status: ApplicationStatus.OFFER_SENT,
      roleId: role.id,
    },
  });

  const offer = await prisma.offer.create({
    data: {
      applicationId: application.id,
      token: "slack-state-offer-token",
      status: OfferStatus.SENT,
      jobTitle: role.title,
      startDate: new Date("2026-04-15T00:00:00.000Z"),
      baseSalary: "NPR 300,000 / month",
      reportingManager: "Jordan Lee",
      generatedContent: "Offer body",
      generatedHtml: "<p>Offer body</p>",
      sentAt: new Date(),
    },
  });

  return {
    application,
    offer,
  };
}

describe("signOffer Slack onboarding preparation", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it("keeps the candidate at offer signed when Slack onboarding preparation fails", async () => {
    getSlackServiceMock.mockReturnValue({
      inviteCandidate: vi.fn().mockRejectedValue(new Error("Slack is unavailable.")),
    });

    const { application, offer } = await createOfferFixture();

    await signOffer({
      offerId: offer.id,
      signerName: "Slack State Candidate",
      signerIp: "127.0.0.1",
      signatureDataUrl: "data:image/png;base64,abc",
    });

    const updatedApplication = await prisma.application.findUniqueOrThrow({
      where: { id: application.id },
    });
    const onboardingEvents = await prisma.onboardingEvent.findMany({
      where: { applicationId: application.id },
    });
    const statusNotes = await prisma.statusHistory.findMany({
      where: { applicationId: application.id },
      orderBy: { createdAt: "asc" },
    });

    expect(updatedApplication.status).toBe(ApplicationStatus.OFFER_SIGNED);
    expect(onboardingEvents).toHaveLength(0);
    expect(statusNotes.at(-1)?.note).toContain("Slack onboarding could not be prepared");
  });

  it("records a connect-ready event when Slack uses the candidate connect flow", async () => {
    getSlackServiceMock.mockReturnValue({
      inviteCandidate: vi.fn().mockResolvedValue({
        externalId: "slack-state@example.com",
        mode: "connect_link",
      }),
    });

    const { application, offer } = await createOfferFixture();

    await signOffer({
      offerId: offer.id,
      signerName: "Slack State Candidate",
      signerIp: "127.0.0.1",
      signatureDataUrl: "data:image/png;base64,abc",
    });

    const updatedApplication = await prisma.application.findUniqueOrThrow({
      where: { id: application.id },
    });
    const onboardingEvent = await prisma.onboardingEvent.findFirstOrThrow({
      where: { applicationId: application.id },
    });
    const statusHistory = await prisma.statusHistory.findMany({
      where: { applicationId: application.id },
      orderBy: { createdAt: "asc" },
    });

    expect(updatedApplication.status).toBe(ApplicationStatus.SLACK_INVITED);
    expect(onboardingEvent.type).toBe(OnboardingEventType.SLACK_CONNECT_READY);
    expect(statusHistory.at(-1)?.note).toBe("Slack onboarding link prepared after offer signature.");
  });
});
