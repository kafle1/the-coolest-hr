// @vitest-environment node

import { ApplicationStatus, RoleStatus } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { summarizeTranscriptMock, retrieveTranscriptMock } = vi.hoisted(() => ({
  summarizeTranscriptMock: vi.fn(),
  retrieveTranscriptMock: vi.fn(),
}));

vi.mock("@/lib/ai/service", () => ({
  getAiService: () => ({
    summarizeTranscript: summarizeTranscriptMock,
    screenResume: vi.fn(),
    researchCandidate: vi.fn(),
    reviewFeedback: vi.fn(),
    generateOfferLetter: vi.fn(),
    generateSlackWelcome: vi.fn(),
  }),
}));

vi.mock("@/lib/fireflies/service", () => ({
  getTranscriptService: () => ({
    startLiveMeetingCapture: vi.fn(),
    findLiveMeetingByLink: vi.fn(),
    retrieveTranscript: retrieveTranscriptMock,
  }),
}));

import { ingestTranscriptFromWebhook } from "@/lib/applications/service";
import { prisma } from "@/lib/prisma/client";
import { disconnectDatabase, resetDatabase } from "@/tests/helpers/db";

async function seedInterviewApplication(input?: {
  status?: ApplicationStatus;
  notetakerMeetingId?: string;
}) {
  const role = await prisma.role.create({
    data: {
      slug: `transcript-role-${Math.random().toString(36).slice(2, 8)}`,
      title: "AI Product Operator",
      team: "Product",
      location: "Nepal",
      remoteStatus: "Remote",
      experienceLevel: "Senior",
      summary: "Transcript role",
      responsibilities: ["Run interviews"],
      requirements: ["Handle transcripts"],
      status: RoleStatus.OPEN,
    },
  });

  const application = await prisma.application.create({
    data: {
      fullName: "Transcript Candidate",
      email: `transcript-${Math.random().toString(36).slice(2, 8)}@example.com`,
      linkedinUrl: "https://linkedin.com/in/transcript-candidate",
      status: input?.status ?? ApplicationStatus.INTERVIEW_SCHEDULED,
      roleId: role.id,
    },
  });

  const interviewPlan = await prisma.interviewPlan.create({
    data: {
      applicationId: application.id,
      interviewerName: "Jordan Lee",
      interviewerEmail: "jordan@example.com",
      interviewerCalendarId: "calendar-id",
    },
  });

  const interview = await prisma.interview.create({
    data: {
      applicationId: application.id,
      interviewPlanId: interviewPlan.id,
      startsAt: new Date("2026-03-30T04:15:00.000Z"),
      endsAt: new Date("2026-03-30T05:00:00.000Z"),
      meetingUrl: "https://meet.google.com/test-meeting",
      notetakerMeetingId: input?.notetakerMeetingId,
    },
  });

  return {
    application,
    interview,
  };
}

describe("ingestTranscriptFromWebhook", () => {
  beforeEach(async () => {
    await resetDatabase();
    summarizeTranscriptMock.mockResolvedValue({
      summary: "Candidate communicated clearly and handled trade-offs well.",
      bulletPoints: ["Strong communication", "Clear technical judgment"],
    });
    retrieveTranscriptMock.mockReset();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it("stores pasted interview notes and advances the application", async () => {
    const { application, interview } = await seedInterviewApplication();

    retrieveTranscriptMock.mockResolvedValue({
      provider: "direct-input",
      providerMeetingId: undefined,
      summary: "Interview transcript for Transcript Candidate (AI Product Operator).",
      bulletPoints: [],
      fullText:
        "Candidate described shipping AI workflows, clarified trade-offs, and asked strong product questions.",
      retrievedAt: new Date("2026-03-30T05:05:00.000Z"),
    });

    const result = await ingestTranscriptFromWebhook({
      applicationId: application.id,
      directText:
        "Candidate described shipping AI workflows, clarified trade-offs, and asked strong product questions.",
    });

    const refreshedApplication = await prisma.application.findUniqueOrThrow({
      where: { id: application.id },
      include: {
        interview: {
          include: {
            transcript: true,
          },
        },
      },
    });

    expect(result.message).toBe("Transcript stored and interview moved to completed.");
    expect(refreshedApplication.status).toBe(ApplicationStatus.INTERVIEW_COMPLETED);
    expect(refreshedApplication.interview?.id).toBe(interview.id);
    expect(refreshedApplication.interview?.notetakerProvider).toBe("manual");
    expect(refreshedApplication.interview?.notetakerState).toBe("TRANSCRIPT_STORED");
    expect(refreshedApplication.interview?.transcript?.summary).toBe(
      "Candidate communicated clearly and handled trade-offs well.",
    );
  });

  it("reuses the stored Fireflies meeting ID when the admin does not paste one", async () => {
    const { application } = await seedInterviewApplication({
      notetakerMeetingId: "fireflies-meeting-123",
    });

    retrieveTranscriptMock.mockResolvedValue({
      provider: "fireflies",
      providerMeetingId: "fireflies-meeting-123",
      summary: "Interview completed for Transcript Candidate (AI Product Operator).",
      bulletPoints: ["Ownership"],
      fullText: "Interviewer: Walk me through the system. Candidate: I optimized for reliability.",
      retrievedAt: new Date("2026-03-30T05:05:00.000Z"),
    });

    await ingestTranscriptFromWebhook({
      applicationId: application.id,
    });

    expect(retrieveTranscriptMock).toHaveBeenCalledWith({
      providerMeetingId: "fireflies-meeting-123",
      directText: undefined,
      candidateName: "Transcript Candidate",
      roleTitle: "AI Product Operator",
    });

    const refreshedApplication = await prisma.application.findUniqueOrThrow({
      where: { id: application.id },
      include: {
        interview: {
          include: {
            transcript: true,
          },
        },
      },
    });

    expect(refreshedApplication.status).toBe(ApplicationStatus.INTERVIEW_COMPLETED);
    expect(refreshedApplication.interview?.notetakerProvider).toBe("fireflies");
    expect(refreshedApplication.interview?.notetakerMeetingId).toBe("fireflies-meeting-123");
    expect(refreshedApplication.interview?.transcript?.providerMeetingId).toBe(
      "fireflies-meeting-123",
    );
  });
});
