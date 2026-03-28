import { describe, expect, it } from "vitest";

import { validateResumeFile } from "@/lib/storage/files";

describe("validateResumeFile", () => {
  it("accepts valid PDF uploads", () => {
    const file = new File(["resume"], "resume.pdf", {
      type: "application/pdf",
    });

    expect(() => validateResumeFile(file)).not.toThrow();
  });

  it("accepts PDF uploads when the browser omits the MIME type", () => {
    const file = new File(["resume"], "resume.pdf");

    expect(() => validateResumeFile(file)).not.toThrow();
  });

  it("rejects unsupported file types", () => {
    const file = new File(["resume"], "resume.txt", {
      type: "text/plain",
    });

    expect(() => validateResumeFile(file)).toThrow("Please upload a PDF or DOCX resume.");
  });

  it("rejects oversized uploads", () => {
    const content = new Uint8Array(5 * 1024 * 1024 + 1);
    const file = new File([content], "resume.pdf", {
      type: "application/pdf",
    });

    expect(() => validateResumeFile(file)).toThrow("Resume upload must be smaller than 5 MB.");
  });
});
