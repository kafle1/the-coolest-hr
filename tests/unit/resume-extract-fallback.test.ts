// @vitest-environment node

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

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

  setTimeout(() => {
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
  beforeEach(() => {
    vi.resetModules();
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("uses pdftotext output when the native parser is available", async () => {
    spawnMock.mockImplementation(() =>
        createMockChildProcess({
          stdout: "Candidate Example\nBuilt hiring automation",
        }),
      );

    const { extractResumeText } = await import("@/lib/resume/extract-text");
    const extractedText = await extractResumeText(
      "resume.pdf",
      "application/pdf",
      Buffer.from("%PDF-1.4"),
    );

    expect(extractedText).toContain("Candidate Example");
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0]?.[0]).toBe("pdftotext");
  });

  it("falls back to the worker parser when pdftotext is unavailable", async () => {
    const missingCommand = Object.assign(new Error("pdftotext not found"), {
      code: "ENOENT",
    });
    spawnMock
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

    const { extractResumeText } = await import("@/lib/resume/extract-text");
    const extractedText = await extractResumeText(
      "resume.pdf",
      "application/pdf",
      Buffer.from("%PDF-1.4"),
    );

    expect(extractedText).toContain("Worker extracted candidate profile");
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[0]?.[0]).toBe("pdftotext");
    expect((spawnMock.mock.calls[1]?.[1] as string[])[0]).toContain("pdf-text-worker.mjs");
  });
});
