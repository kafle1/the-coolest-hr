// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { completeSlackOnboardingMock, getSlackServiceMock } = vi.hoisted(() => ({
  completeSlackOnboardingMock: vi.fn(),
  getSlackServiceMock: vi.fn(),
}));

vi.mock("@/lib/offers/service", () => ({
  completeSlackOnboarding: completeSlackOnboardingMock,
}));

vi.mock("@/lib/slack/service", () => ({
  getSlackService: getSlackServiceMock,
}));

import { POST } from "@/app/api/integrations/slack/events/route";

describe("POST /api/integrations/slack/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 for invalid Slack signatures", async () => {
    getSlackServiceMock.mockReturnValue({
      verifyRequestSignature: vi.fn().mockReturnValue(false),
      getUserEmail: vi.fn(),
    });

    const response = await POST(
      new Request("http://localhost/api/integrations/slack/events", {
        method: "POST",
        headers: {
          "x-slack-request-timestamp": "1",
          "x-slack-signature": "bad",
        },
        body: JSON.stringify({ event: { type: "team_join" } }),
      }),
    );

    expect(response.status).toBe(401);
    expect(completeSlackOnboardingMock).not.toHaveBeenCalled();
  });

  it("looks up the Slack user's email when the event payload omits it", async () => {
    const getUserEmail = vi.fn().mockResolvedValue("candidate@example.com");

    getSlackServiceMock.mockReturnValue({
      verifyRequestSignature: vi.fn().mockReturnValue(true),
      getUserEmail,
    });

    const response = await POST(
      new Request("http://localhost/api/integrations/slack/events", {
        method: "POST",
        headers: {
          "x-slack-request-timestamp": "1",
          "x-slack-signature": "good",
        },
        body: JSON.stringify({
          event: {
            type: "team_join",
            user: {
              id: "U12345",
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(getUserEmail).toHaveBeenCalledWith("U12345");
    expect(completeSlackOnboardingMock).toHaveBeenCalledWith({
      email: "candidate@example.com",
      slackUserId: "U12345",
    });
  });

  it("returns 400 for malformed Slack payloads", async () => {
    getSlackServiceMock.mockReturnValue({
      verifyRequestSignature: vi.fn().mockReturnValue(true),
      getUserEmail: vi.fn(),
    });

    const response = await POST(
      new Request("http://localhost/api/integrations/slack/events", {
        method: "POST",
        headers: {
          "x-slack-request-timestamp": "1",
          "x-slack-signature": "good",
        },
        body: "{invalid",
      }),
    );

    expect(response.status).toBe(400);
    expect(completeSlackOnboardingMock).not.toHaveBeenCalled();
  });
});
