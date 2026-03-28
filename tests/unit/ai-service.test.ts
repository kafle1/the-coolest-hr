import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { openAiChatCreateMock, openAiResponsesParseMock } = vi.hoisted(() => ({
  openAiChatCreateMock: vi.fn(),
  openAiResponsesParseMock: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: openAiChatCreateMock,
      },
    };

    responses = {
      parse: openAiResponsesParseMock,
    };
  },
}));

describe("getAiService", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    openAiChatCreateMock.mockReset();
    openAiResponsesParseMock.mockReset();
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

  it("repairs malformed JSON before schema validation", async () => {
    const { parseStructuredJson } = await import("@/lib/ai/service");
    const schema = z.object({
      summary: z.string(),
      achievements: z.array(z.string()),
    });

    const parsed = parseStructuredJson(
      `Here is the result:
      {
        "summary": "Built AI systems
that stayed in production",
        "achievements": [
          "Shipped screening automation",
          "Integrated scheduling"
        ],
      }
      `,
      schema,
    );

    expect(parsed).toEqual({
      summary: "Built AI systems\nthat stayed in production",
      achievements: ["Shipped screening automation", "Integrated scheduling"],
    });
  });

  it("retries OpenRouter research when the provider returns a 429", async () => {
    openAiChatCreateMock
      .mockRejectedValueOnce(
        Object.assign(new Error("429 Provider returned error"), {
          status: 429,
          headers: new Headers({
            "retry-after-ms": "0",
          }),
        }),
      )
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                brief: "Public evidence supports the shortlisted decision.",
                linkedinSummary: "LinkedIn aligns with the submitted resume.",
                githubSummary: "GitHub shows relevant public repositories.",
                discrepancies: [],
                limitations: [],
                sources: [
                  {
                    label: "Submitted LinkedIn profile",
                    url: "https://www.linkedin.com/in/example",
                  },
                ],
              }),
            },
          },
        ],
      });

    process.env.AI_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.OPENROUTER_MODEL = "stepfun/step-3.5-flash:free";

    const { getAiService } = await import("@/lib/ai/service");
    const result = await getAiService().researchCandidate({
      fullName: "Candidate Example",
      roleTitle: "AI Product Operator",
      linkedinUrl: "https://www.linkedin.com/in/example",
      portfolioUrl: "https://github.com/example",
      resumeSummary: "Built AI workflows and internal tools.",
    });

    expect(openAiChatCreateMock).toHaveBeenCalledTimes(2);
    expect(result.brief).toBe("Public evidence supports the shortlisted decision.");
    expect(result.sources).toEqual([
      {
        label: "Submitted LinkedIn profile",
        url: "https://www.linkedin.com/in/example",
      },
    ]);
  });
});
