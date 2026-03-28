import "dotenv/config";

import { writeFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

test.setTimeout(120_000);

function escapePdfText(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

async function createResumePdf(filePath: string) {
  const stream = [
    "BT",
    "/F1 11 Tf",
    "72 720 Td",
    `(${escapePdfText("Niraj Kafle")}) Tj`,
    "0 -18 Td",
    `(${escapePdfText("AI operations analyst with 4 years building hiring automation, RAG workflows, interview scheduling, Slack onboarding, Google Calendar coordination, and candidate screening systems.")}) Tj`,
    "0 -18 Td",
    `(${escapePdfText("Hands-on with TypeScript, Next.js, PostgreSQL, Docker, OpenAI, Anthropic, workflow automation, structured evaluation, and operator tooling.")}) Tj`,
    "0 -18 Td",
    `(${escapePdfText("Built end-to-end recruiting operations products that parse resumes, shortlist candidates, research public profiles, send scheduling options, generate offers, and trigger Slack onboarding.")}) Tj`,
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

  await writeFile(filePath, pdf, "utf8");
}

test("submitting an application completes intake and exposes live admin activity", async ({
  page,
  request,
}, testInfo) => {
  const email = `playwright-${Date.now()}@example.com`;
  const resumePath = testInfo.outputPath("resume.pdf");
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@niural.com";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "test_admin_pwd";

  await createResumePdf(resumePath);

  await page.goto("/apply");
  await page.getByLabel("Full name").fill("Niraj Kafle");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("LinkedIn URL").fill("https://linkedin.com/in/nirajkafle");
  await page.getByLabel("Portfolio or GitHub").fill("https://github.com/kafle1");
  const roleField = page.getByLabel("Role");
  const roleLabels = await roleField.locator("option").allTextContents();
  const preferredRole =
    roleLabels.find((label) => /ai operations analyst/i.test(label)) ?? roleLabels[0];

  await roleField.selectOption({ label: preferredRole });
  await page.getByLabel("Resume").setInputFiles(resumePath);
  await page.getByRole("button", { name: "Submit application" }).click();

  await expect(
    page.getByText("Application received. We will email you as your application moves forward."),
  ).toBeVisible({ timeout: 90_000 });

  const statusResponse = await request.get(
    `/api/applications/status?email=${encodeURIComponent(email)}`,
  );
  expect(statusResponse.ok()).toBeTruthy();

  const statusPayload = (await statusResponse.json()) as {
    applications: Array<{
      id: string;
      status: string;
    }>;
  };
  const application = statusPayload.applications[0];

  expect(application).toBeTruthy();
  expect(application.status).not.toBe("APPLIED");

  await page.goto(`/admin/candidates/${application.id}`);
  await expect(page).toHaveURL(/\/admin\/login/);

  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(new RegExp(`/admin/candidates/${application.id}$`));
  await expect(page.getByRole("heading", { name: "Live stage progress" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pipeline events, emails, and onboarding updates" })).toBeVisible();
  await expect(page.getByText("Application automation started.")).toBeVisible();
  await expect(page.getByText(/Screening completed with a score of/)).toBeVisible();
});
