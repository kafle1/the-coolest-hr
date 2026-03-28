// @vitest-environment node

import { readdir, rm } from "node:fs/promises";
import path from "node:path";

import { RoleStatus } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  extractResumeTextMock,
  sendApplicationConfirmationMock,
} = vi.hoisted(() => ({
  extractResumeTextMock: vi.fn(),
  sendApplicationConfirmationMock: vi.fn(),
}));

vi.mock("@/lib/resume/extract-text", () => ({
  extractResumeText: extractResumeTextMock,
}));

vi.mock("@/lib/email/service", () => ({
  sendApplicationConfirmation: sendApplicationConfirmationMock,
  sendInterviewConfirmationEmail: vi.fn(),
  sendInterviewRescheduleAlert: vi.fn(),
  sendSchedulingNudgeEmail: vi.fn(),
  sendSchedulingOptionsEmail: vi.fn(),
}));

import { submitApplication } from "@/lib/applications/service";
import { prisma } from "@/lib/prisma/client";
import { disconnectDatabase, resetDatabase } from "@/tests/helpers/db";

const resumeDirectory = path.join(process.cwd(), "data", "resumes");

async function listStoredResumes() {
  const entries = await readdir(resumeDirectory).catch(() => []);
  return entries.sort();
}

async function seedRole() {
  return prisma.role.create({
    data: {
      slug: `submit-role-${Math.random().toString(36).slice(2, 8)}`,
      title: "AI Product Operator",
      team: "Product",
      location: "Nepal",
      remoteStatus: "Remote",
      experienceLevel: "Senior",
      summary: "Submit role",
      responsibilities: ["Ship tools"],
      requirements: ["Write code"],
      status: RoleStatus.OPEN,
    },
  });
}

function buildApplicationForm(roleId: string, email = "candidate@example.com") {
  const formData = new FormData();

  formData.set("fullName", "Candidate Example");
  formData.set("email", email);
  formData.set("linkedinUrl", "https://linkedin.com/in/candidate");
  formData.set("portfolioUrl", "");
  formData.set("roleId", roleId);
  formData.set(
    "resume",
    new File(["resume"], "resume.pdf", {
      type: "application/pdf",
    }),
  );

  return formData;
}

describe("submitApplication", () => {
  beforeEach(async () => {
    await resetDatabase();
    extractResumeTextMock.mockResolvedValue(
      "Senior AI operator with TypeScript and AI workflow experience.",
    );
    sendApplicationConfirmationMock.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    extractResumeTextMock.mockReset();
    sendApplicationConfirmationMock.mockReset();
    await rm(resumeDirectory, { recursive: true, force: true });
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it("returns the clean duplicate error and removes the written resume file", async () => {
    const role = await seedRole();
    const beforeFiles = await listStoredResumes();

    await prisma.application.create({
      data: {
        fullName: "Existing Candidate",
        email: "candidate@example.com",
        linkedinUrl: "https://linkedin.com/in/existing",
        roleId: role.id,
      },
    });

    await expect(
      submitApplication(buildApplicationForm(role.id, "CANDIDATE@example.com")),
    ).rejects.toThrow("You have already applied to this role with this email address.");

    expect(await listStoredResumes()).toEqual(beforeFiles);
  });

  it("keeps the application when the confirmation email fails and records an audit note", async () => {
    const role = await seedRole();
    sendApplicationConfirmationMock.mockRejectedValueOnce(new Error("Resend is down"));

    const { applicationId, confirmationEmailError } = await submitApplication(
      buildApplicationForm(role.id),
    );
    const application = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      include: {
        statusHistory: true,
      },
    });

    expect(application.email).toBe("candidate@example.com");
    expect(confirmationEmailError).toBe("Resend is down");
    expect(application.statusHistory.some((entry) => entry.actorLabel === "Confirmation email")).toBe(true);
  });
});
