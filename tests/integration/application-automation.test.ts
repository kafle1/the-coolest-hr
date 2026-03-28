// @vitest-environment node

import { rm } from "node:fs/promises";
import path from "node:path";

import { ApplicationStatus, RoleStatus } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  screenResumeMock,
  extractResumeTextMock,
  sendApplicationConfirmationMock,
  sendSchedulingOptionsEmailMock,
  buildCandidateResearchMock,
} = vi.hoisted(() => ({
  screenResumeMock: vi.fn(),
  extractResumeTextMock: vi.fn(),
  sendApplicationConfirmationMock: vi.fn(),
  sendSchedulingOptionsEmailMock: vi.fn(),
  buildCandidateResearchMock: vi.fn(),
}));

vi.mock("@/lib/resume/extract-text", () => ({
  extractResumeText: extractResumeTextMock,
}));

vi.mock("@/lib/ai/service", () => ({
  getAiService: () => ({
    screenResume: screenResumeMock,
    researchCandidate: vi.fn(),
    summarizeTranscript: vi.fn(),
    reviewFeedback: vi.fn(),
    generateOfferLetter: vi.fn(),
    generateSlackWelcome: vi.fn(),
  }),
}));

vi.mock("@/lib/research/service", () => ({
  buildCandidateResearch: buildCandidateResearchMock,
}));

vi.mock("@/lib/email/service", () => ({
  sendApplicationConfirmation: sendApplicationConfirmationMock,
  sendInterviewRescheduleAlert: vi.fn(),
  sendSchedulingNudgeEmail: vi.fn(),
  sendSchedulingOptionsEmail: sendSchedulingOptionsEmailMock,
  sendOfferSignedAlert: vi.fn(),
}));

import {
  runApplicationAutomation,
  submitApplication,
} from "@/lib/applications/service";
import { prisma } from "@/lib/prisma/client";
import { disconnectDatabase, resetDatabase } from "@/tests/helpers/db";

const resumeDirectory = path.join(process.cwd(), "data", "resumes");

function buildApplicationForm(roleId: string) {
  const formData = new FormData();

  formData.set("fullName", "Automation Candidate");
  formData.set("email", "automation@example.com");
  formData.set("linkedinUrl", "https://linkedin.com/in/automation");
  formData.set("portfolioUrl", "https://github.com/example");
  formData.set("roleId", roleId);
  formData.set(
    "resume",
    new File(["resume"], "resume.pdf", {
      type: "application/pdf",
    }),
  );

  return formData;
}

describe("runApplicationAutomation", () => {
  beforeEach(async () => {
    await resetDatabase();
    extractResumeTextMock.mockResolvedValue(
      "TypeScript engineer with AI workflow and Docker experience.",
    );
    sendApplicationConfirmationMock.mockResolvedValue(undefined);
    sendSchedulingOptionsEmailMock.mockResolvedValue(undefined);
    screenResumeMock.mockResolvedValue({
      score: 89,
      summary: "Strong fit for the role based on backend, AI workflow, and DevOps experience.",
      strengths: ["Strong TypeScript background", "Built RAG systems"],
      gaps: ["Needs confirmation on calendar tooling depth"],
      parsedSkills: ["typescript", "rag", "docker"],
      yearsExperience: 4,
      education: {
        highestDegree: "Bachelor's",
        focus: "Information Technology",
      },
      pastEmployers: ["FunCove LLC", "Lancemeup Pvt. Ltd."],
      achievements: ["Built RAG systems for conversational workflows."],
    });
    buildCandidateResearchMock.mockResolvedValue({
      brief: "Candidate shows strong public and submitted evidence for the role.",
      linkedinSummary: "LinkedIn aligns with the resume.",
      xSummary: null,
      githubSummary: "GitHub shows relevant automation work.",
      portfolioSummary: null,
      discrepancies: [],
      limitations: [],
      sources: [
        { label: "Submitted LinkedIn profile", url: "https://linkedin.com/in/automation" },
      ],
    });
  });

  afterEach(async () => {
    screenResumeMock.mockReset();
    extractResumeTextMock.mockReset();
    sendApplicationConfirmationMock.mockReset();
    sendSchedulingOptionsEmailMock.mockReset();
    buildCandidateResearchMock.mockReset();
    await rm(resumeDirectory, { recursive: true, force: true });
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it("screens, researches, and sends interview options automatically for shortlisted candidates", async () => {
    const role = await prisma.role.create({
      data: {
        slug: "automation-role",
        title: "AI Operations Analyst",
        team: "Operations",
        location: "Remote",
        remoteStatus: "Remote",
        experienceLevel: "Senior",
        summary: "Own AI operations workflows.",
        responsibilities: ["Screen candidates", "Improve automation"],
        requirements: ["TypeScript", "RAG systems", "Docker"],
        status: RoleStatus.OPEN,
      },
    });

    const applicationId = await submitApplication(buildApplicationForm(role.id));
    const savedApplication = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      include: {
        screeningResult: true,
      },
    });

    expect(savedApplication.status).toBe(ApplicationStatus.APPLIED);
    expect(savedApplication.screeningResult).toBeNull();

    await runApplicationAutomation(applicationId);

    const application = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      include: {
        screeningResult: true,
        researchProfile: true,
        interviewPlan: {
          include: {
            holds: true,
          },
        },
        statusHistory: true,
      },
    });

    expect(application.status).toBe(ApplicationStatus.INTERVIEW_PENDING);
    expect(application.screeningResult?.score).toBe(89);
    expect(application.researchProfile?.brief).toContain("strong public and submitted evidence");
    expect(application.interviewPlan?.holds).toHaveLength(3);
    expect(application.statusHistory.map((entry) => entry.actorLabel)).toEqual(
      expect.arrayContaining([
        "Automation",
        "AI screening",
        "Candidate research",
        "Scheduling automation",
      ]),
    );
    expect(
      application.statusHistory.some(
        (entry) => entry.note === "Scheduling completed with 3 interview options.",
      ),
    ).toBe(true);
    expect(sendSchedulingOptionsEmailMock).toHaveBeenCalledOnce();
  });
});
