// @vitest-environment node

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

type MockChildProcess = EventEmitter & {
  kill(): void;
  stderr: PassThrough;
  stdin: PassThrough;
  stdout: PassThrough;
};

function createMockChildProcess(options?: {
  code?: number;
  error?: Error;
  stderr?: string;
  stdout?: string;
}) {
  const child = new EventEmitter() as MockChildProcess;

  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();

  queueMicrotask(() => {
    if (options?.error) {
      child.emit("error", options.error);
      return;
    }

    if (options?.stdout) {
      child.stdout.write(options.stdout);
    }

    if (options?.stderr) {
      child.stderr.write(options.stderr);
    }

    child.stdout.end();
    child.stderr.end();
    child.emit("close", options?.code ?? 0);
  });

  return child;
}

describe("extractResumeText PDF fallback order", () => {
  afterEach(() => {
    vi.doUnmock("node:child_process");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("uses pdftotext output when the native parser is available", async () => {
    const spawn = vi
      .fn()
      .mockImplementation(() =>
        createMockChildProcess({
          stdout: "Candidate Example\nBuilt hiring automation",
        }),
      );

    vi.doMock("node:child_process", () => ({
      spawn,
    }));

    const { extractResumeText } = await import("@/lib/resume/extract-text");
    const extractedText = await extractResumeText(
      "resume.pdf",
      "application/pdf",
      Buffer.from("%PDF-1.4"),
    );

    expect(extractedText).toContain("Candidate Example");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0]?.[0]).toBe("pdftotext");
  });

  it("falls back to the worker parser when pdftotext is unavailable", async () => {
    const missingCommand = Object.assign(new Error("pdftotext not found"), {
      code: "ENOENT",
    });
    const spawn = vi
      .fn()
      .mockImplementationOnce(() =>
        createMockChildProcess({
          error: missingCommand,
        }),
      )
      .mockImplementationOnce(() =>
        createMockChildProcess({
          stdout: JSON.stringify({
            text: "Worker extracted candidate profile",
          }),
        }),
      );

    vi.doMock("node:child_process", () => ({
      spawn,
    }));

    const { extractResumeText } = await import("@/lib/resume/extract-text");
    const extractedText = await extractResumeText(
      "resume.pdf",
      "application/pdf",
      Buffer.from("%PDF-1.4"),
    );

    expect(extractedText).toContain("Worker extracted candidate profile");
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[0]?.[0]).toBe("pdftotext");
    expect((spawn.mock.calls[1]?.[1] as string[])[0]).toContain("pdf-text-worker.mjs");
  });
});
