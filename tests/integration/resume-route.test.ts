// @vitest-environment node

import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { RoleStatus } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/admin/applications/[id]/resume/route";
import { prisma } from "@/lib/prisma/client";
import { disconnectDatabase, resetDatabase } from "@/tests/helpers/db";

const createdResumePaths: string[] = [];

async function createStoredResume(contents: string) {
  const resumeDirectory = path.join(process.cwd(), "data", "resumes");
  const storagePath = path.join(
    resumeDirectory,
    `${randomUUID()}-resume.pdf`,
  );

  await mkdir(resumeDirectory, { recursive: true });
  await writeFile(storagePath, contents, "utf8");
  createdResumePaths.push(storagePath);

  return storagePath;
}

async function seedApplication() {
  const role = await prisma.role.create({
    data: {
      slug: `resume-role-${randomUUID()}`,
      title: "AI Product Operator",
      team: "Product",
      location: "Nepal",
      remoteStatus: "Remote",
      experienceLevel: "Senior",
      summary: "Resume role",
      responsibilities: ["Ship tools"],
      requirements: ["Write code"],
      status: RoleStatus.OPEN,
    },
  });

  return prisma.application.create({
    data: {
      fullName: "Resume Candidate",
      email: `resume-${randomUUID()}@example.com`,
      linkedinUrl: "https://linkedin.com/in/resume",
      roleId: role.id,
    },
  });
}

describe("GET /api/admin/applications/[id]/resume", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await Promise.all(
      createdResumePaths.splice(0).map(async (storagePath) => {
        await unlink(storagePath).catch(() => undefined);
      }),
    );
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it("streams the stored resume bytes for a valid application", async () => {
    const application = await seedApplication();
    const storagePath = await createStoredResume("demo resume bytes");

    await prisma.resumeAsset.create({
      data: {
        applicationId: application.id,
        originalName: "resume.pdf",
        mimeType: "application/pdf",
        sizeBytes: 17,
        storagePath,
      },
    });

    const response = await GET(
      new Request(`http://localhost/api/admin/applications/${application.id}/resume`),
      { params: Promise.resolve({ id: application.id }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("inline");
    expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).toBe(
      "demo resume bytes",
    );
  });

  it("returns 404 when the application has no resume asset", async () => {
    const application = await seedApplication();

    const response = await GET(
      new Request(`http://localhost/api/admin/applications/${application.id}/resume`),
      { params: Promise.resolve({ id: application.id }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      message: "Resume was not found for this application.",
    });
  });

  it("returns 404 when the application does not exist", async () => {
    const response = await GET(
      new Request("http://localhost/api/admin/applications/missing/resume"),
      { params: Promise.resolve({ id: "missing" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      message: "Application was not found.",
    });
  });
});
