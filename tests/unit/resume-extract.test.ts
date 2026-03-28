// @vitest-environment node

import { describe, expect, it } from "vitest";

import { extractResumeText } from "@/lib/resume/extract-text";

function escapePdfText(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function createResumePdfBytes() {
  const stream = [
    "BT",
    "/F1 11 Tf",
    "72 720 Td",
    `(${escapePdfText("Niraj Kafle")}) Tj`,
    "0 -18 Td",
    `(${escapePdfText("AI product operator with TypeScript, Next.js, and recruiting operations experience.")}) Tj`,
    "0 -18 Td",
    `(${escapePdfText("Built hiring automation, candidate screening tools, and scheduling systems.")}) Tj`,
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

describe("extractResumeText", () => {
  it("extracts text from a valid PDF resume", async () => {
    const extractedText = await extractResumeText(
      "resume.pdf",
      "application/pdf",
      createResumePdfBytes(),
    );

    expect(extractedText).toContain("Niraj Kafle");
    expect(extractedText).toContain("hiring automation");
  });

  it("returns a clean error for an invalid PDF", async () => {
    await expect(
      extractResumeText("resume.pdf", "application/pdf", Buffer.from("not a real pdf")),
    ).rejects.toThrow(
      "We couldn't read the uploaded PDF. Please upload a standard PDF or DOCX resume.",
    );
  });
});
