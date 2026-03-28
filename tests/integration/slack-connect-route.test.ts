// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findUniqueMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
}));

vi.mock("@/lib/prisma/client", () => ({
  prisma: {
    offer: {
      findUnique: findUniqueMock,
    },
  },
}));

describe("GET /api/integrations/slack/connect", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    findUniqueMock.mockReset();
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_APP_URL: "https://stale.example.com",
      ADMIN_EMAIL: "admin@niural.com",
      ADMIN_PASSWORD: "admin123",
      SESSION_SIGNING_SECRET: "test-session-secret",
      SLACK_CLIENT_ID: "123.456",
      SLACK_CLIENT_SECRET: "slack-secret",
      SLACK_REDIRECT_URI: "",
      SLACK_TEAM_ID: "T12345",
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("uses the active request host for Slack redirect URIs", async () => {
    findUniqueMock.mockResolvedValue({
      status: "SIGNED",
      token: "offer-token-123",
    });

    const { GET } = await import("@/app/api/integrations/slack/connect/route");
    const response = await GET(
      new Request("https://preview.example.com/api/integrations/slack/connect?offer=offer-token-123"),
    );
    const location = response.headers.get("location");

    expect(response.status).toBe(307);
    expect(location).toBeTruthy();

    const redirectUrl = new URL(location ?? "");

    expect(redirectUrl.origin + redirectUrl.pathname).toBe(
      "https://slack.com/openid/connect/authorize",
    );
    expect(redirectUrl.searchParams.get("redirect_uri")).toBe(
      "https://preview.example.com/api/integrations/slack/connect/callback",
    );
    expect(redirectUrl.searchParams.get("team")).toBe("T12345");
  });

  it("falls back to the forwarded host when the app is behind a proxy", async () => {
    findUniqueMock.mockResolvedValue({
      status: "SIGNED",
      token: "offer-token-123",
    });

    const { GET } = await import("@/app/api/integrations/slack/connect/route");
    const response = await GET(
      new Request("http://127.0.0.1:3000/api/integrations/slack/connect?offer=offer-token-123", {
        headers: {
          "x-forwarded-host": "hiring.example.com",
          "x-forwarded-proto": "https",
        },
      }),
    );
    const location = response.headers.get("location");

    expect(location).toBeTruthy();

    const redirectUrl = new URL(location ?? "");

    expect(redirectUrl.searchParams.get("redirect_uri")).toBe(
      "https://hiring.example.com/api/integrations/slack/connect/callback",
    );
  });

  it("prefers the explicit redirect override when a tunnel callback is configured", async () => {
    process.env.SLACK_REDIRECT_URI = "https://candidate-flow.ngrok-free.app";
    findUniqueMock.mockResolvedValue({
      status: "SIGNED",
      token: "offer-token-123",
    });

    const { GET } = await import("@/app/api/integrations/slack/connect/route");
    const response = await GET(
      new Request("https://preview.example.com/api/integrations/slack/connect?offer=offer-token-123"),
    );
    const location = response.headers.get("location");

    expect(location).toBeTruthy();

    const redirectUrl = new URL(location ?? "");

    expect(redirectUrl.searchParams.get("redirect_uri")).toBe(
      "https://candidate-flow.ngrok-free.app/api/integrations/slack/connect/callback",
    );
  });

  it("redirects back for setup when a localhost callback would be sent to Slack", async () => {
    findUniqueMock.mockResolvedValue({
      status: "SIGNED",
      token: "offer-token-123",
    });

    const { GET } = await import("@/app/api/integrations/slack/connect/route");
    const response = await GET(
      new Request("http://localhost:3000/api/integrations/slack/connect?offer=offer-token-123"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/offers/sign/offer-token-123?slack=setup",
    );
  });

  it("redirects failed Slack attempts back to the same host", async () => {
    findUniqueMock.mockResolvedValue(null);

    const { GET } = await import("@/app/api/integrations/slack/connect/route");
    const response = await GET(
      new Request("https://preview.example.com/api/integrations/slack/connect?offer=offer-token-123"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://preview.example.com/offers/sign/offer-token-123?slack=failed",
    );
  });
});
