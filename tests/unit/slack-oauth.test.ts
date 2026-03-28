import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("slack oauth helpers", () => {
  const originalEnv = { ...process.env };
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  beforeEach(() => {
    vi.resetModules();
    fetchSpy.mockReset();
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
    fetchSpy.mockReset();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    fetchSpy.mockRestore();
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
    const redirectUri = "http://localhost:3000/api/integrations/slack/connect/callback";

    const url = new URL(
      buildSlackConnectUrl({
        nonce: "nonce-123",
        redirectUri,
        state: "state-123",
      }),
    );

    expect(url.origin + url.pathname).toBe("https://slack.com/openid/connect/authorize");
    expect(url.searchParams.get("client_id")).toBe("123.456");
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(url.searchParams.get("team")).toBe("T12345");
    expect(url.searchParams.get("response_mode")).toBe("form_post");
  });

  it("builds a relative Slack connect start path", async () => {
    const { getSlackCandidateConnectStartPath } = await import("@/lib/slack/oauth");

    expect(getSlackCandidateConnectStartPath("offer-token-123")).toBe(
      "/api/integrations/slack/connect?offer=offer-token-123",
    );
  });

  it("derives the redirect URI from forwarded request headers", async () => {
    const { getSlackOAuthRedirectUri } = await import("@/lib/slack/oauth");
    const request = new Request("http://internal-host/api/integrations/slack/connect", {
      headers: {
        "x-forwarded-host": "preview.example.com",
        "x-forwarded-proto": "https",
      },
    });

    expect(getSlackOAuthRedirectUri(request)).toBe(
      "https://preview.example.com/api/integrations/slack/connect/callback",
    );
  });

  it("reuses the same redirect URI during token exchange", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access-token",
          id_token: "header.payload.signature",
          ok: true,
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
          status: 200,
        },
      ),
    );

    const { exchangeSlackConnectCode } = await import("@/lib/slack/oauth");
    const redirectUri = "https://preview.example.com/api/integrations/slack/connect/callback";

    await exchangeSlackConnectCode({
      code: "code-123",
      redirectUri,
    });

    expect(fetchSpy).toHaveBeenCalledOnce();

    const [, requestInit] = fetchSpy.mock.calls[0] ?? [];
    const body = requestInit?.body;

    expect(body).toBeInstanceOf(URLSearchParams);
    expect((body as URLSearchParams).get("redirect_uri")).toBe(redirectUri);
    expect((body as URLSearchParams).get("code")).toBe("code-123");
  });
});
