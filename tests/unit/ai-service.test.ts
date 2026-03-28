import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("getAiService", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      AI_PROVIDER: "auto",
    };
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws a clear error when no AI provider is configured", async () => {
    const { getAiService } = await import("@/lib/ai/service");

    expect(() => getAiService()).toThrow(
      "No AI provider is configured. Set OPENROUTER_API_KEY or OPENAI_API_KEY.",
    );
  });

  it("throws a clear error when OPENAI is selected without a key", async () => {
    process.env.AI_PROVIDER = "openai";
    const { getAiService } = await import("@/lib/ai/service");

    expect(() => getAiService()).toThrow(
      "AI_PROVIDER is set to openai but OPENAI_API_KEY is missing.",
    );
  });

  it("throws a clear error when OpenRouter is selected without a key", async () => {
    process.env.AI_PROVIDER = "openrouter";
    const { getAiService } = await import("@/lib/ai/service");

    expect(() => getAiService()).toThrow(
      "AI_PROVIDER is set to openrouter but OPENROUTER_API_KEY is missing.",
    );
  });
});
