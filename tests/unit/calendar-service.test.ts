// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  calendarMock,
  freebusyQueryMock,
  createHoldEventMock,
} = vi.hoisted(() => ({
  freebusyQueryMock: vi.fn(),
  createHoldEventMock: vi.fn(),
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
    },
    calendar: calendarMock,
  },
}));

const originalNodeEnv = process.env.NODE_ENV;
const originalCalendarId = process.env.GOOGLE_CALENDAR_ID;
const originalServiceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const originalServiceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
const env = process.env as Record<string, string | undefined>;

describe("getCalendarService", () => {
  beforeEach(() => {
    vi.resetModules();
    freebusyQueryMock.mockReset();
    createHoldEventMock.mockReset();
    calendarMock.mockClear();

    env.NODE_ENV = "development";
    env.GOOGLE_CALENDAR_ID = "broken-calendar";
    env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "test@example.com";
    env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = "fake-key";
  });

  afterEach(() => {
    env.NODE_ENV = originalNodeEnv;
    env.GOOGLE_CALENDAR_ID = originalCalendarId;
    env.GOOGLE_SERVICE_ACCOUNT_EMAIL = originalServiceAccountEmail;
    env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = originalServiceAccountKey;
  });

  it("falls back to local slots when Google freebusy returns not found", async () => {
    freebusyQueryMock.mockRejectedValueOnce(
      Object.assign(new Error("Requested entity was not found."), { status: 404 }),
    );

    const { getCalendarService } = await import("@/lib/calendar/service");
    const service = getCalendarService();
    const slots = await service.findAvailableSlots({
      reserved: [],
      count: 2,
    });

    expect(freebusyQueryMock).toHaveBeenCalledTimes(1);
    expect(slots).toHaveLength(2);
  });

  it("keeps using local mode after a recoverable Google Calendar failure", async () => {
    freebusyQueryMock.mockRejectedValueOnce(
      Object.assign(new Error("Not Found"), { status: 404 }),
    );

    const { getCalendarService } = await import("@/lib/calendar/service");
    const service = getCalendarService();

    await service.findAvailableSlots({
      reserved: [],
      count: 1,
    });

    freebusyQueryMock.mockClear();

    const fallbackService = getCalendarService();
    const hold = await fallbackService.createHoldEvent({
      holdId: "hold-1",
      applicationId: "app-1",
      candidateName: "Candidate Example",
      roleTitle: "AI Product Operator",
      startsAt: new Date("2026-04-01T10:00:00.000Z"),
      endsAt: new Date("2026-04-01T10:45:00.000Z"),
    });

    expect(freebusyQueryMock).not.toHaveBeenCalled();
    expect(createHoldEventMock).not.toHaveBeenCalled();
    expect(hold.eventId).toBe("local-hold-hold-1");
  });
});
