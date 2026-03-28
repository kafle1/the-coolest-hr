import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function normalizeExtractedText(value: string) {
  return value.replace(/\f/g, "\n").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const PDF_EXTRACTION_TIMEOUT_MS = 15_000;
const PDF_WORKER_PATH = path.join(process.cwd(), "lib", "resume", "pdf-text-worker.mjs");

function resolveNodeBinary() {
  const configured = process.env.NODE_BINARY?.trim();

  if (configured) {
    return configured;
  }

  if (path.basename(process.execPath).toLowerCase().includes("node")) {
    return process.execPath;
  }

  return "node";
}

function buildPdfExtractionError(message?: string) {
  const normalized = message?.trim();

  if (!normalized) {
    return new Error(
      "We couldn't read the uploaded PDF. Please upload a standard PDF or DOCX resume.",
    );
  }

  if (
    normalized.includes("Invalid PDF") ||
    normalized.includes("Unexpected end of input") ||
    normalized.includes("FormatError") ||
    normalized.includes("DOMMatrix is not defined") ||
    normalized.includes("Cannot polyfill `DOMMatrix`") ||
    normalized.includes("process.getBuiltinModule is not a function")
  ) {
    return new Error(
      "We couldn't read the uploaded PDF. Please upload a standard PDF or DOCX resume.",
    );
  }

  return new Error(normalized);
}

async function extractPdfText(bytes: Buffer) {
  let nativeExtractionError: Error | undefined;

  try {
    const nativeText = await extractPdfTextWithPdftotext(bytes);

    if (nativeText) {
      return nativeText;
    }
  } catch (error) {
    nativeExtractionError = error instanceof Error ? error : new Error(String(error));
  }

  try {
    const workerText = await extractPdfTextWithWorker(bytes);

    if (workerText) {
      return workerText;
    }
  } catch (error) {
    throw buildPdfExtractionError(
      error instanceof Error ? error.message : nativeExtractionError?.message,
    );
  }

  throw buildPdfExtractionError(nativeExtractionError?.message);
}

async function extractPdfTextWithPdftotext(bytes: Buffer) {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "niural-resume-"));
  const tempFilePath = path.join(tempDirectory, "resume.pdf");

  try {
    await writeFile(tempFilePath, bytes);

    return await new Promise<string | null>((resolve, reject) => {
      const command = spawn("pdftotext", ["-layout", tempFilePath, "-"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        command.kill();
        reject(
          new Error(
            "Resume parsing took too long. Please try again with a smaller or simpler PDF.",
          ),
        );
      }, PDF_EXTRACTION_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timer);
      };

      command.stdout.setEncoding("utf8");
      command.stderr.setEncoding("utf8");

      command.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });

      command.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      command.on("error", (error) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();

        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          resolve(null);
          return;
        }

        reject(error);
      });

      command.on("close", (code) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();

        if (code !== 0) {
          reject(new Error(stderr.trim() || "Unable to extract PDF text."));
          return;
        }

        const normalizedText = normalizeExtractedText(stdout);
        resolve(normalizedText || null);
      });
    });
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function extractPdfTextWithWorker(bytes: Buffer) {
  return new Promise<string>((resolve, reject) => {
    const worker = spawn(resolveNodeBinary(), [PDF_WORKER_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      worker.kill();
      reject(
        new Error(
          "Resume parsing took too long. Please try again with a smaller or simpler PDF.",
        ),
      );
    }, PDF_EXTRACTION_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timer);
    };

    worker.stdout.setEncoding("utf8");
    worker.stderr.setEncoding("utf8");

    worker.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    worker.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    worker.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    });

    worker.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();

      if (code !== 0) {
        reject(buildPdfExtractionError(stderr));
        return;
      }

      try {
        const payload = JSON.parse(stdout) as {
          text?: string;
          error?: string;
        };

        if (payload.error) {
          reject(buildPdfExtractionError(payload.error));
          return;
        }

        resolve(normalizeExtractedText(payload.text ?? ""));
      } catch {
        const normalizedText = normalizeExtractedText(stdout);

        if (normalizedText) {
          resolve(normalizedText);
          return;
        }

        reject(
          new Error(
            "We couldn't read the uploaded PDF. Please upload a standard PDF or DOCX resume.",
          ),
        );
      }
    });

    worker.stdin.end(bytes.toString("base64"));
  });
}

export async function extractResumeText(fileName: string, mimeType: string, bytes: Buffer) {
  if (mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) {
    return extractPdfText(bytes);
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileName.toLowerCase().endsWith(".docx")
  ) {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: bytes });
      return normalizeExtractedText(result.value);
    } catch {
      throw new Error(
        "We couldn't read the uploaded DOCX file. Please upload a standard DOCX or PDF resume.",
      );
    }
  }

  throw new Error("Unsupported resume format.");
}
