// @vitest-environment node

import {
  ApplicationStatus,
  OfferStatus,
  OnboardingEventType,
  RoleStatus,
} from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/service", () => ({
  getAiService: () => ({
    generateSlackWelcome: vi.fn().mockResolvedValue({
      message: "Welcome to Niural!",
    }),
  }),
}));

vi.mock("@/lib/slack/service", () => ({
  getSlackService: () => ({
    sendDirectMessage: vi.fn(),
    notifyHr: vi.fn(),
    getUserEmail: vi.fn().mockResolvedValue("slack@example.com"),
  }),
}));

import { completeSlackOnboarding } from "@/lib/offers/service";
import { prisma } from "@/lib/prisma/client";
import { disconnectDatabase, resetDatabase } from "@/tests/helpers/db";

describe("completeSlackOnboarding", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it("handles Slack retries without duplicating onboarding events", async () => {
    const role = await prisma.role.create({
      data: {
        slug: "slack-role",
        title: "AI Product Operator",
        team: "Product",
        location: "Nepal",
        remoteStatus: "Remote",
        experienceLevel: "Senior",
        summary: "Slack role",
        responsibilities: ["Ship tools"],
        requirements: ["Write code"],
        status: RoleStatus.OPEN,
      },
    });

    const application = await prisma.application.create({
      data: {
        fullName: "Slack Candidate",
        email: "slack@example.com",
        linkedinUrl: "https://linkedin.com/in/slack",
        status: ApplicationStatus.SLACK_INVITED,
        roleId: role.id,
        offer: {
          create: {
            token: "slack-offer-token",
            status: OfferStatus.SIGNED,
            jobTitle: role.title,
            startDate: new Date("2026-04-15T00:00:00.000Z"),
            baseSalary: "NPR 300,000 / month",
            reportingManager: "Jordan Lee",
            generatedContent: "Offer body",
            generatedHtml: "<p>Offer body</p>",
            sentAt: new Date(),
            signedAt: new Date(),
            signerName: "Slack Candidate",
            signerIp: "127.0.0.1",
            signatureDataUrl: "data:image/png;base64,abc",
          },
        },
      },
    });

    await completeSlackOnboarding({
      email: application.email,
      slackUserId: "U12345",
    });
    const onboardedApplication = await completeSlackOnboarding({
      email: application.email,
      slackUserId: "U12345",
    });

    const events = await prisma.onboardingEvent.findMany({
      where: { applicationId: application.id },
      orderBy: { createdAt: "asc" },
    });

    expect(onboardedApplication.status).toBe(ApplicationStatus.ONBOARDED);
    expect(events.filter((event) => event.type === OnboardingEventType.SLACK_TEAM_JOIN)).toHaveLength(1);
    expect(events.filter((event) => event.type === OnboardingEventType.WELCOME_SENT)).toHaveLength(1);
    expect(events.filter((event) => event.type === OnboardingEventType.HR_NOTIFIED)).toHaveLength(1);
  });
});
