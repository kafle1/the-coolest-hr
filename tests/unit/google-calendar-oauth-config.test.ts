// @vitest-environment node

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = process.env as Record<string, string | undefined>;
const oauthConfigPath = path.join(process.cwd(), "data", "google-calendar-oauth.json");
const originalOauthConfig = existsSync(oauthConfigPath)
  ? readFileSync(oauthConfigPath, "utf8")
  : null;
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;
const originalAuthMode = process.env.GOOGLE_CALENDAR_AUTH_MODE;
const originalCalendarId = process.env.GOOGLE_CALENDAR_ID;
const originalClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const originalClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const originalRefreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

describe("google calendar oauth config", () => {
  beforeEach(() => {
    vi.resetModules();
    rmSync(oauthConfigPath, { force: true });

    env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    env.GOOGLE_CALENDAR_AUTH_MODE = "oauth-refresh";
    env.GOOGLE_CALENDAR_ID = "kafleniraj@gmail.com";
    env.GOOGLE_OAUTH_CLIENT_ID = "client-id";
    env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret";
    delete env.GOOGLE_OAUTH_REFRESH_TOKEN;
  });

  afterEach(() => {
    if (originalOauthConfig == null) {
      rmSync(oauthConfigPath, { force: true });
    } else {
      writeFileSync(oauthConfigPath, originalOauthConfig, "utf8");
    }

    env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    env.GOOGLE_CALENDAR_AUTH_MODE = originalAuthMode;
    env.GOOGLE_CALENDAR_ID = originalCalendarId;
    env.GOOGLE_OAUTH_CLIENT_ID = originalClientId;
    env.GOOGLE_OAUTH_CLIENT_SECRET = originalClientSecret;
    env.GOOGLE_OAUTH_REFRESH_TOKEN = originalRefreshToken;
  });

  it("prefers the primary writable calendar", async () => {
    const { pickDefaultGoogleCalendar } = await import("@/lib/calendar/oauth-config");
    const selected = pickDefaultGoogleCalendar([
      {
        id: "secondary@group.calendar.google.com",
        accessRole: "owner",
        summary: "Secondary",
      },
      {
        id: "kafleniraj@gmail.com",
        accessRole: "owner",
        primary: true,
        summary: "Niraj Kafle",
      },
    ]);

    expect(selected).toEqual({
      calendarId: "kafleniraj@gmail.com",
      connectedEmail: "kafleniraj@gmail.com",
      summary: "Niraj Kafle",
    });
  });

  it("falls back to the first writable calendar when there is no primary entry", async () => {
    const { pickDefaultGoogleCalendar } = await import("@/lib/calendar/oauth-config");
    const selected = pickDefaultGoogleCalendar([
      {
        id: "secondary@group.calendar.google.com",
        accessRole: "owner",
        summary: "Secondary",
      },
    ]);

    expect(selected).toEqual({
      calendarId: "secondary@group.calendar.google.com",
      connectedEmail: undefined,
      summary: "Secondary",
    });
  });

  it("marks oauth mode as disconnected until a refresh token exists", async () => {
    const { getGoogleCalendarConnectionState } = await import("@/lib/calendar/oauth-config");
    const connection = getGoogleCalendarConnectionState();

    expect(connection).toMatchObject({
      authMode: "oauth-refresh",
      connected: false,
      connectUrl: "http://localhost:3000/api/integrations/google-calendar/connect",
      reason: "missing-refresh-token",
    });
  });
});
