// @vitest-environment node

import { rm } from "node:fs/promises";
import path from "node:path";

import { RoleStatus } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email/service", () => ({
  sendApplicationConfirmation: vi.fn().mockResolvedValue(undefined),
  sendInterviewConfirmationEmail: vi.fn(),
  sendInterviewRescheduleAlert: vi.fn(),
  sendSchedulingNudgeEmail: vi.fn(),
  sendSchedulingOptionsEmail: vi.fn(),
}));

import { submitApplication } from "@/lib/applications/service";
import { prisma } from "@/lib/prisma/client";
import { disconnectDatabase, resetDatabase } from "@/tests/helpers/db";

const resumeDirectory = path.join(process.cwd(), "data", "resumes");

function escapePdfText(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function createResumePdfBytes() {
  const stream = [
    "BT",
    "/F1 11 Tf",
    "72 720 Td",
    `(${escapePdfText("Candidate Example")}) Tj`,
    "0 -18 Td",
    `(${escapePdfText("Built hiring automation and screening systems with TypeScript.")}) Tj`,
    "0 -18 Td",
    `(${escapePdfText("Experienced with recruiting operations, scheduling, and AI workflows.")}) Tj`,
    "ET",
  ].join("\n");

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += object;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");

  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";

  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}

async function seedRole() {
  return prisma.role.create({
    data: {
      slug: `submit-pdf-role-${Math.random().toString(36).slice(2, 8)}`,
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
    new File([createResumePdfBytes()], "resume.pdf", {
      type: "application/pdf",
    }),
  );

  return formData;
}

describe("submitApplication with real PDF extraction", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await rm(resumeDirectory, { recursive: true, force: true });
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it("stores extracted PDF text on the application", async () => {
    const role = await seedRole();
    const { applicationId } = await submitApplication(
      buildApplicationForm(role.id, "real-pdf@example.com"),
    );
    const application = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      include: {
        resumeAsset: true,
      },
    });

    expect(application.resumeAsset?.extractedText).toContain("Candidate Example");
    expect(application.resumeAsset?.extractedText).toContain("hiring automation");
  });
});
