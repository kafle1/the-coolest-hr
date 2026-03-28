import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("slack oauth helpers", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      ADMIN_EMAIL: "admin@niural.com",
      ADMIN_PASSWORD: "admin123",
      SESSION_SIGNING_SECRET: "test-session-secret",
      SLACK_CLIENT_ID: "123.456",
      SLACK_CLIENT_SECRET: "slack-secret",
      SLACK_TEAM_ID: "T12345",
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("round-trips the signed Slack connect state", async () => {
    const { createSlackConnectState, verifySlackConnectState } = await import(
      "@/lib/slack/oauth"
    );

    const { nonce, state } = await createSlackConnectState("offer-token-123");
    const verifiedState = await verifySlackConnectState(state);

    expect(verifiedState).toEqual({
      nonce,
      offerToken: "offer-token-123",
    });
  });

  it("builds a Slack connect URL pinned to the configured team", async () => {
    const { buildSlackConnectUrl } = await import("@/lib/slack/oauth");

    const url = new URL(
      buildSlackConnectUrl({
        nonce: "nonce-123",
        state: "state-123",
      }),
    );

    expect(url.origin + url.pathname).toBe("https://slack.com/openid/connect/authorize");
    expect(url.searchParams.get("client_id")).toBe("123.456");
    expect(url.searchParams.get("team")).toBe("T12345");
    expect(url.searchParams.get("response_mode")).toBe("form_post");
  });
});
