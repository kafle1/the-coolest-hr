import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("FirefliesTranscriptService", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.FIREFLIES_API_KEY = "fireflies-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FIREFLIES_API_KEY;
  });

  it("throws a clear error when Fireflies responds with a non-200 status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: {
          get: vi.fn().mockReturnValue(null),
        },
      }),
    );

    const { getTranscriptService } = await import("@/lib/fireflies/service");

    await expect(
      getTranscriptService().retrieveTranscript({
        providerMeetingId: "meeting-123",
        candidateName: "Candidate",
        roleTitle: "AI Product Operator",
      }),
    ).rejects.toThrow("Fireflies returned 503 when fetching the transcript.");
  });

  it("includes the provider error message when Fireflies returns one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: {
          get: vi.fn().mockReturnValue("application/json"),
        },
        json: vi.fn().mockResolvedValue({
          errors: [{ message: "Rate limit exceeded" }],
        }),
      }),
    );

    const { getTranscriptService } = await import("@/lib/fireflies/service");

    await expect(
      getTranscriptService().retrieveTranscript({
        providerMeetingId: "meeting-123",
        candidateName: "Candidate",
        roleTitle: "AI Product Operator",
      }),
    ).rejects.toThrow(
      "Fireflies returned 429 when fetching the transcript: Rate limit exceeded",
    );
  });

  it("maps supported summary fields and transcript sentences into the stored payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: {
            transcript: {
              id: "meeting-123",
              summary: {
                short_summary: "Candidate covered shipping tradeoffs clearly.",
                bullet_gist: ["Strong ownership"],
                shorthand_bullet: "Good system design\nHandled edge cases",
              },
              sentences: [
                { text: "Interviewer: Walk me through the architecture." },
                { text: "Candidate: I focused on reliability first." },
              ],
            },
          },
        }),
      }),
    );

    const { getTranscriptService } = await import("@/lib/fireflies/service");
    const transcript = await getTranscriptService().retrieveTranscript({
      providerMeetingId: "meeting-123",
      candidateName: "Candidate",
      roleTitle: "AI Product Operator",
    });

    expect(transcript.summary).toBe("Candidate covered shipping tradeoffs clearly.");
    expect(transcript.bulletPoints).toEqual([
      "Strong ownership",
      "Good system design",
      "Handled edge cases",
    ]);
    expect(transcript.fullText).toContain("Interviewer: Walk me through the architecture.");
    expect(transcript.fullText).toContain("Candidate: I focused on reliability first.");
  });
});
