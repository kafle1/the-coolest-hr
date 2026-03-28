// @vitest-environment node

import {
  ActorType,
  ApplicationStatus,
  HoldStatus,
  OfferStatus,
  OnboardingEventType,
  RoleStatus,
} from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import CandidateDetailPage from "@/app/admin/candidates/[id]/page";
import { prisma } from "@/lib/prisma/client";
import { disconnectDatabase, resetDatabase } from "@/tests/helpers/db";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

describe("CandidateDetailPage", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it("renders resume evidence, research limitations, and onboarding state", async () => {
    const role = await prisma.role.create({
      data: {
        slug: "candidate-detail-role",
        title: "AI Product Operator",
        team: "Product",
        location: "Nepal",
        remoteStatus: "Remote",
        experienceLevel: "Senior",
        summary: "Detail role",
        responsibilities: ["Ship tools"],
        requirements: ["Write code"],
        status: RoleStatus.OPEN,
      },
    });

    const application = await prisma.application.create({
      data: {
        fullName: "Detail Candidate",
        email: "detail@example.com",
        linkedinUrl: "https://linkedin.com/in/detail",
        status: ApplicationStatus.SLACK_INVITED,
        roleId: role.id,
        resumeAsset: {
          create: {
            originalName: "detail-resume.pdf",
            mimeType: "application/pdf",
            sizeBytes: 2048,
            storagePath: "/tmp/detail-resume.pdf",
            extractedText:
              "Built AI-powered operator tooling across screening, scheduling, and onboarding workflows.",
          },
        },
        researchProfile: {
          create: {
            brief: "Strong operator-style candidate with visible public work.",
            linkedinSummary: "LinkedIn matches the submitted progression.",
            xSummary: "Few public posts were available for evaluation.",
            githubSummary: "GitHub shows working automation projects.",
            portfolioSummary: "Portfolio supports hands-on product execution.",
            discrepancies: [
              "Submitted resume lists two years at Acme, but LinkedIn shows one year and eleven months.",
            ],
            limitations: [
              "Public X activity is limited, so the system treated missing evidence as neutral.",
            ],
            sources: [
              { label: "LinkedIn", url: "https://linkedin.com/in/detail" },
            ],
          },
        },
        offer: {
          create: {
            token: "detail-offer-token",
            status: OfferStatus.SIGNED,
            jobTitle: "AI Product Operator",
            startDate: new Date("2026-04-15T00:00:00.000Z"),
            baseSalary: "NPR 300,000 / month",
            reportingManager: "Jordan Lee",
            generatedContent: "Offer body",
            generatedHtml: "<p>Offer body</p>",
            sentAt: new Date("2026-03-20T00:00:00.000Z"),
            signedAt: new Date("2026-03-21T00:00:00.000Z"),
            signerName: "Detail Candidate",
            signerIp: "127.0.0.1",
            signatureDataUrl: "data:image/png;base64,abc",
            alertSentAt: new Date("2026-03-21T00:05:00.000Z"),
          },
        },
        onboardingEvents: {
          create: {
            type: OnboardingEventType.SLACK_INVITE_SENT,
            externalId: "invite-123",
          },
        },
        statusHistory: {
          create: {
            toStatus: ApplicationStatus.SLACK_INVITED,
            actorType: ActorType.INTEGRATION,
            actorLabel: "Slack",
            note: "Slack invitation sent.",
          },
        },
      },
    });

    const markup = renderToStaticMarkup(
      await CandidateDetailPage({
        params: Promise.resolve({ id: application.id }),
      }),
    );

    expect(markup).toContain("Resume and source material");
    expect(markup).toContain("detail-resume.pdf");
    expect(markup).toContain("AI-powered operator tooling across screening");
    expect(markup).toContain("LinkedIn shows one year and eleven months");
    expect(markup).toContain("system treated missing evidence as neutral");
    expect(markup).toContain("Signed by");
    expect(markup).toContain("Detail Candidate");
    expect(markup).toContain("Live activity");
    expect(markup).toContain("Slack Invite Sent");
  });

  it("returns notFound cleanly when the candidate no longer exists", async () => {
    await expect(
      CandidateDetailPage({
        params: Promise.resolve({ id: "missing-candidate-id" }),
      }),
    ).rejects.toThrow("notFound");
  });

  it("keeps live refresh enabled while interview confirmation is still pending", async () => {
    const role = await prisma.role.create({
      data: {
        slug: "candidate-detail-refresh-role",
        title: "AI Product Operator",
        team: "Product",
        location: "Nepal",
        remoteStatus: "Remote",
        experienceLevel: "Senior",
        summary: "Detail role",
        responsibilities: ["Ship tools"],
        requirements: ["Write code"],
        status: RoleStatus.OPEN,
      },
    });

    const application = await prisma.application.create({
      data: {
        fullName: "Refresh Candidate",
        email: "refresh@example.com",
        linkedinUrl: "https://linkedin.com/in/refresh",
        status: ApplicationStatus.INTERVIEW_PENDING,
        roleId: role.id,
        statusHistory: {
          createMany: {
            data: [
              {
                toStatus: ApplicationStatus.APPLIED,
                actorType: ActorType.CANDIDATE,
                actorLabel: "Refresh Candidate",
                note: "Candidate submitted a new application.",
              },
              {
                toStatus: ApplicationStatus.INTERVIEW_PENDING,
                actorType: ActorType.SYSTEM,
                actorLabel: "Scheduling",
                note: "Interview options sent to candidate.",
              },
              {
                toStatus: ApplicationStatus.INTERVIEW_PENDING,
                actorType: ActorType.SYSTEM,
                actorLabel: "Automation",
                note: "Application automation completed.",
              },
            ],
          },
        },
        interviewPlan: {
          create: {
            interviewerName: "Jordan Lee",
            interviewerEmail: "jordan@example.com",
            interviewerCalendarId: "calendar-id",
            holds: {
              create: {
                token: "refresh-token",
                startsAt: new Date("2026-03-30T04:15:00.000Z"),
                endsAt: new Date("2026-03-30T05:00:00.000Z"),
                expiresAt: new Date("2026-03-31T04:15:00.000Z"),
                status: HoldStatus.HELD,
              },
            },
          },
        },
      },
    });

    const markup = renderToStaticMarkup(
      await CandidateDetailPage({
        params: Promise.resolve({ id: application.id }),
      }),
    );

    expect(markup).toContain("Watching for live updates");
    expect(markup).toContain(
      "automation, candidate actions, or external integrations can still change this record",
    );
  });
});
