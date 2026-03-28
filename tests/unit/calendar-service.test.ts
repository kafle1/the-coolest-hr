// @vitest-environment node

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  calendarMock,
  freebusyQueryMock,
  createHoldEventMock,
  oauth2Mock,
} = vi.hoisted(() => ({
  freebusyQueryMock: vi.fn(),
  createHoldEventMock: vi.fn(),
  oauth2Mock: vi.fn(function MockOAuth2() {
    return {
      setCredentials: vi.fn(),
    };
  }),
  calendarMock: vi.fn(() => ({
    freebusy: {
      query: freebusyQueryMock,
    },
    events: {
      insert: createHoldEventMock,
      patch: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(),
    },
  })),
}));

vi.mock("googleapis", () => ({
  google: {
    auth: {
      JWT: vi.fn(),
      OAuth2: oauth2Mock,
    },
    calendar: calendarMock,
  },
}));

const originalNodeEnv = process.env.NODE_ENV;
const originalGoogleCalendarAuthMode = process.env.GOOGLE_CALENDAR_AUTH_MODE;
const originalCalendarId = process.env.GOOGLE_CALENDAR_ID;
const originalServiceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const originalServiceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
const originalGoogleOAuthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const originalGoogleOAuthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const originalGoogleOAuthRefreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
const oauthConfigPath = path.join(process.cwd(), "data", "google-calendar-oauth.json");
const originalOauthConfig = existsSync(oauthConfigPath)
  ? readFileSync(oauthConfigPath, "utf8")
  : null;
const env = process.env as Record<string, string | undefined>;

describe("getCalendarService", () => {
  beforeEach(() => {
    vi.resetModules();
    freebusyQueryMock.mockReset();
    createHoldEventMock.mockReset();
    calendarMock.mockClear();
    oauth2Mock.mockClear();
    rmSync(oauthConfigPath, { force: true });

    env.NODE_ENV = "development";
    env.GOOGLE_CALENDAR_AUTH_MODE = "service-account";
    env.GOOGLE_CALENDAR_ID = "broken-calendar";
    env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "test@example.com";
    env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = "fake-key";
    env.GOOGLE_OAUTH_CLIENT_ID = "client-id";
    env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret";
    delete env.GOOGLE_OAUTH_REFRESH_TOKEN;
  });

  afterEach(() => {
    env.NODE_ENV = originalNodeEnv;
    env.GOOGLE_CALENDAR_AUTH_MODE = originalGoogleCalendarAuthMode;
    env.GOOGLE_CALENDAR_ID = originalCalendarId;
    env.GOOGLE_SERVICE_ACCOUNT_EMAIL = originalServiceAccountEmail;
    env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = originalServiceAccountKey;
    env.GOOGLE_OAUTH_CLIENT_ID = originalGoogleOAuthClientId;
    env.GOOGLE_OAUTH_CLIENT_SECRET = originalGoogleOAuthClientSecret;
    env.GOOGLE_OAUTH_REFRESH_TOKEN = originalGoogleOAuthRefreshToken;

    if (originalOauthConfig == null) {
      rmSync(oauthConfigPath, { force: true });
    } else {
      writeFileSync(oauthConfigPath, originalOauthConfig, "utf8");
    }
  });

  it("requires user-calendar OAuth before real scheduling starts", async () => {
    const { getCalendarService } = await import("@/lib/calendar/service");
    const service = getCalendarService();

    await expect(service.assertInterviewSchedulingReady()).rejects.toThrow(
      "Connect Google Calendar from the admin workspace",
    );
    expect(calendarMock).not.toHaveBeenCalled();
  });

  it("surfaces a clear error when Google freebusy returns not found", async () => {
    freebusyQueryMock.mockRejectedValueOnce(
      Object.assign(new Error("Requested entity was not found."), { status: 404 }),
    );

    const { getCalendarService } = await import("@/lib/calendar/service");
    const service = getCalendarService();

    await expect(
      service.findAvailableSlots({
        reserved: [],
        count: 2,
      }),
    ).rejects.toThrow("GOOGLE_CALENDAR_ID is not accessible");
    expect(freebusyQueryMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a clear error when oauth mode is selected but the calendar is not connected yet", async () => {
    env.GOOGLE_CALENDAR_AUTH_MODE = "oauth-refresh";

    const { getCalendarService } = await import("@/lib/calendar/service");
    const service = getCalendarService();

    await expect(service.assertInterviewSchedulingReady()).rejects.toThrow(
      "Google Calendar is not connected yet",
    );
    expect(calendarMock).not.toHaveBeenCalled();
    expect(oauth2Mock).not.toHaveBeenCalled();
  });

  it("uses the test calendar service in tests", async () => {
    const { getCalendarService } = await import("@/lib/calendar/service");
    env.NODE_ENV = "test";
    const service = getCalendarService();
    await expect(service.assertInterviewSchedulingReady()).resolves.toBeUndefined();
    const hold = await service.createHoldEvent({
      holdId: "hold-1",
      applicationId: "app-1",
      candidateName: "Candidate Example",
      roleTitle: "AI Product Operator",
      startsAt: new Date("2026-04-01T10:00:00.000Z"),
      endsAt: new Date("2026-04-01T10:45:00.000Z"),
    });

    expect(freebusyQueryMock).not.toHaveBeenCalled();
    expect(createHoldEventMock).not.toHaveBeenCalled();
    expect(hold.eventId).toBe("test-hold-hold-1");
  });
});
