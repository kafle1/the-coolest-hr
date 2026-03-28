import { randomUUID } from "node:crypto";

import { google } from "googleapis";
import {
  addBusinessDays,
  addMinutes,
  isWeekend,
  setHours,
  setMinutes,
  startOfDay,
} from "date-fns";

import {
  getGoogleCalendarConnectionState,
  getResolvedGoogleCalendarAuthMode,
  getResolvedGoogleCalendarId,
  getResolvedGoogleCalendarRefreshToken,
} from "@/lib/calendar/oauth-config";
import { badRequest, conflict } from "@/lib/utils/errors";
import { env, requireValue } from "@/lib/utils/env";

const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

export type CalendarSlot = {
  startsAt: Date;
  endsAt: Date;
};

export interface CalendarService {
  assertInterviewSchedulingReady(): Promise<void>;
  findAvailableSlots(input: {
    reserved: CalendarSlot[];
    count: number;
  }): Promise<CalendarSlot[]>;
  createHoldEvent(input: {
    holdId: string;
    applicationId: string;
    candidateName: string;
    roleTitle: string;
    startsAt: Date;
    endsAt: Date;
  }): Promise<{ eventId: string }>;
  confirmHoldEvent(input: {
    eventId: string;
    candidateName: string;
    candidateEmail: string;
    roleTitle: string;
    startsAt: Date;
    endsAt: Date;
  }): Promise<{ eventId: string; meetingUrl: string }>;
  releaseHoldEvent(eventId: string): Promise<void>;
  getAttendeeResponseStatus(input: {
    eventId: string;
    candidateEmail: string;
  }): Promise<"NEEDS_ACTION" | "ACCEPTED" | "DECLINED">;
}

function overlaps(left: CalendarSlot, right: CalendarSlot) {
  return left.startsAt < right.endsAt && right.startsAt < left.endsAt;
}

function buildCandidateSlots() {
  const slots: CalendarSlot[] = [];
  const slotHours = [10, 11, 13, 14, 16];

  for (let offset = 1; slots.length < 25; offset += 1) {
    const day = addBusinessDays(startOfDay(new Date()), offset);

    if (isWeekend(day)) {
      continue;
    }

    for (const hour of slotHours) {
      const startsAt = setMinutes(setHours(day, hour), 0);
      slots.push({
        startsAt,
        endsAt: addMinutes(startsAt, 45),
      });
    }
  }

  return slots;
}

class TestCalendarService implements CalendarService {
  async assertInterviewSchedulingReady() {}

  async findAvailableSlots(input: { reserved: CalendarSlot[]; count: number }) {
    return buildCandidateSlots()
      .filter((slot) => !input.reserved.some((reserved) => overlaps(slot, reserved)))
      .slice(0, input.count);
  }

  async createHoldEvent(input: { holdId: string }) {
    return { eventId: `test-hold-${input.holdId}` };
  }

  async confirmHoldEvent(input: { eventId: string; startsAt: Date }) {
    return {
      eventId: input.eventId,
      meetingUrl: `https://meet.google.com/test-${input.startsAt.getTime()}`,
    };
  }

  async releaseHoldEvent() {}

  async getAttendeeResponseStatus() {
    return "NEEDS_ACTION" as const;
  }
}

function getCalendarId() {
  return requireValue("GOOGLE_CALENDAR_ID", getResolvedGoogleCalendarId());
}

function getServiceAccountEmail() {
  return requireValue("GOOGLE_SERVICE_ACCOUNT_EMAIL", env.googleServiceAccountEmail);
}

function getServiceAccountPrivateKey() {
  return requireValue(
    "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
    env.googleServiceAccountPrivateKey,
  );
}

function getOAuthClientId() {
  return requireValue("GOOGLE_OAUTH_CLIENT_ID", env.googleOAuthClientId);
}

function getOAuthClientSecret() {
  return requireValue("GOOGLE_OAUTH_CLIENT_SECRET", env.googleOAuthClientSecret);
}

function getOAuthRefreshToken() {
  return requireValue("GOOGLE_OAUTH_REFRESH_TOKEN", getResolvedGoogleCalendarRefreshToken());
}

function buildHoldRequestBody(input: {
  applicationId: string;
  holdId: string;
  candidateName: string;
  roleTitle: string;
  startsAt: Date;
  endsAt: Date;
}) {
  return {
    summary: `Hold: ${input.candidateName} / ${input.roleTitle}`,
    description: "Tentative hold for candidate scheduling.",
    start: {
      dateTime: input.startsAt.toISOString(),
    },
    end: {
      dateTime: input.endsAt.toISOString(),
    },
    transparency: "opaque" as const,
    extendedProperties: {
      private: {
        applicationId: input.applicationId,
        holdId: input.holdId,
      },
    },
    conferenceData: {
      createRequest: {
        requestId: randomUUID(),
        conferenceSolutionKey: {
          type: "hangoutsMeet",
        },
      },
    },
  };
}

function extractMeetingUrl(event: {
  hangoutLink?: string | null;
  conferenceData?: {
    entryPoints?: Array<{
      entryPointType?: string | null;
      uri?: string | null;
    }> | null;
  } | null;
}) {
  if (event.hangoutLink?.trim()) {
    return event.hangoutLink.trim();
  }

  const videoEntry = event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === "video" && entry.uri?.trim(),
  );

  return videoEntry?.uri?.trim() ?? null;
}

function readGoogleCalendarErrorStatus(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = error as {
    code?: number | string;
    status?: number;
    response?: {
      status?: number;
      data?: {
        error?: {
          message?: string;
        };
      };
    };
    errors?: Array<{ message?: string }>;
  };

  if (typeof candidate.response?.status === "number") {
    return candidate.response.status;
  }

  if (typeof candidate.status === "number") {
    return candidate.status;
  }

  if (typeof candidate.code === "number") {
    return candidate.code;
  }

  return null;
}

function readGoogleCalendarErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (!error || typeof error !== "object") {
    return "Unknown Google Calendar error.";
  }

  const candidate = error as {
    response?: {
      data?: {
        error?: {
          message?: string;
        };
      };
    };
    errors?: Array<{ message?: string }>;
  };

  return (
    candidate.response?.data?.error?.message?.trim() ||
    candidate.errors?.find((item) => item.message?.trim())?.message?.trim() ||
    "Unknown Google Calendar error."
  );
}

function translateGoogleCalendarError(operation: string, error: unknown) {
  const status = readGoogleCalendarErrorStatus(error);
  const message = readGoogleCalendarErrorMessage(error);
  const normalizedMessage = message.toLowerCase();

  if (
    status === 404 ||
    normalizedMessage.includes("requested entity was not found") ||
    normalizedMessage.includes("not found")
  ) {
    return badRequest(
      `Google Calendar ${operation} failed because GOOGLE_CALENDAR_ID is not accessible to the configured auth.`,
      "google_calendar_not_accessible",
    );
  }

  if (
    normalizedMessage.includes("insufficient authentication scopes") ||
    normalizedMessage.includes("access_token_scope_insufficient")
  ) {
    return badRequest(
      `Google Calendar ${operation} failed because the configured Google OAuth credentials are missing calendar scope.`,
      "google_calendar_scope_missing",
    );
  }

  if (normalizedMessage.includes("invalid_grant")) {
    return badRequest(
      `Google Calendar ${operation} failed because GOOGLE_OAUTH_REFRESH_TOKEN is invalid or expired.`,
      "google_calendar_auth_expired",
    );
  }

  if (
    normalizedMessage.includes(
      "service accounts cannot invite attendees without domain-wide delegation of authority",
    )
  ) {
    return conflict(
      `Google Calendar ${operation} failed because service-account auth cannot send real attendee invites. Switch GOOGLE_CALENDAR_AUTH_MODE to "oauth-refresh" with a real Google user calendar.`,
      "google_calendar_invites_require_user_auth",
    );
  }

  if (normalizedMessage.includes("invalid conference type value")) {
    return conflict(
      `Google Calendar ${operation} failed because Google Meet creation is not available for the current auth mode. Switch GOOGLE_CALENDAR_AUTH_MODE to "oauth-refresh" with a real Google user calendar.`,
      "google_meet_requires_user_auth",
    );
  }

  return badRequest(
    `Google Calendar ${operation} failed: ${message}`,
    "google_calendar_request_failed",
  );
}

async function getGoogleAuthClient() {
  if (getResolvedGoogleCalendarAuthMode() === "oauth-refresh") {
    const oauthClient = new google.auth.OAuth2(
      getOAuthClientId(),
      getOAuthClientSecret(),
    );
    oauthClient.setCredentials({
      refresh_token: getOAuthRefreshToken(),
    });
    return oauthClient;
  }

  return new google.auth.JWT({
    email: getServiceAccountEmail(),
    key: getServiceAccountPrivateKey(),
    scopes: [GOOGLE_CALENDAR_SCOPE],
  });
}

class GoogleCalendarService implements CalendarService {
  private async getCalendar() {
    return google.calendar({
      version: "v3",
      auth: await getGoogleAuthClient(),
    });
  }

  private async run<T>(
    operation: string,
    action: (calendar: ReturnType<typeof google.calendar>) => Promise<T>,
  ) {
    try {
      const calendar = await this.getCalendar();
      return await action(calendar);
    } catch (error) {
      throw translateGoogleCalendarError(operation, error);
    }
  }

  async assertInterviewSchedulingReady() {
    const connection = getGoogleCalendarConnectionState();

    if (connection.authMode !== "oauth-refresh") {
      throw conflict(
        'Real interview scheduling requires a connected Google user calendar. The workspace is still using service-account auth, which cannot send attendee invites or create Google Meet links. Connect Google Calendar from the admin workspace and try again.',
        "google_calendar_real_flow_requires_user_auth",
      );
    }

    if (!connection.connected) {
      throw conflict(
        "Google Calendar is not connected yet. Finish the Google Calendar connection from the admin workspace and try scheduling again.",
        "google_calendar_not_connected",
      );
    }

    await this.run("setup validation", async (calendar) => {
      await calendar.calendars.get({
        calendarId: connection.calendarId!,
      });
    });
  }

  async findAvailableSlots(input: { reserved: CalendarSlot[]; count: number }) {
    return this.run("availability lookup", async (calendar) => {
      const calendarId = getCalendarId();
      const candidates = buildCandidateSlots();
      const timeMin = candidates[0]?.startsAt;
      const timeMax = candidates.at(-1)?.endsAt;

      if (!timeMin || !timeMax) {
        return [];
      }

      const busyResponse = await calendar.freebusy.query({
        requestBody: {
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          items: [{ id: calendarId }],
        },
      });

      const busyPeriods =
        busyResponse.data.calendars?.[calendarId]?.busy?.map((item) => ({
          startsAt: new Date(item.start ?? ""),
          endsAt: new Date(item.end ?? ""),
        })) ?? [];

      return candidates
        .filter(
          (candidate) =>
            !busyPeriods.some((busy) => overlaps(candidate, busy)) &&
            !input.reserved.some((reserved) => overlaps(candidate, reserved)),
        )
        .slice(0, input.count);
    });
  }

  async createHoldEvent(input: {
    holdId: string;
    applicationId: string;
    candidateName: string;
    roleTitle: string;
    startsAt: Date;
    endsAt: Date;
  }) {
    return this.run("hold creation", async (calendar) => {
      const response = await calendar.events.insert({
        calendarId: getCalendarId(),
        conferenceDataVersion: 1,
        requestBody: buildHoldRequestBody(input),
      });

      const eventId = response.data.id?.trim();

      if (!eventId) {
        throw badRequest(
          "Google Calendar created the hold without returning an event id.",
          "google_calendar_event_missing",
        );
      }

      return { eventId };
    });
  }

  async confirmHoldEvent(input: {
    eventId: string;
    candidateName: string;
    candidateEmail: string;
    roleTitle: string;
    startsAt: Date;
    endsAt: Date;
  }) {
    return this.run("event confirmation", async (calendar) => {
      const calendarId = getCalendarId();
      const patchResponse = await calendar.events.patch({
        calendarId,
        eventId: input.eventId,
        conferenceDataVersion: 1,
        sendUpdates: "all",
        requestBody: {
          summary: `${input.roleTitle} interview with ${input.candidateName}`,
          description: "Confirmed interview invite.",
          start: {
            dateTime: input.startsAt.toISOString(),
          },
          end: {
            dateTime: input.endsAt.toISOString(),
          },
          attendees: [
            {
              email: input.candidateEmail,
              displayName: input.candidateName,
            },
          ],
          transparency: "opaque",
        },
      });

      const eventId = patchResponse.data.id?.trim() ?? input.eventId;
      let meetingUrl = extractMeetingUrl(patchResponse.data);

      if (!meetingUrl) {
        const eventResponse = await calendar.events.get({
          calendarId,
          eventId,
        });
        meetingUrl = extractMeetingUrl(eventResponse.data);
      }

      if (!meetingUrl) {
        throw conflict(
          "Google Calendar confirmed the interview but did not return a Google Meet link.",
          "google_meet_missing",
        );
      }

      return {
        eventId,
        meetingUrl,
      };
    });
  }

  async releaseHoldEvent(eventId: string) {
    try {
      const calendar = await this.getCalendar();
      await calendar.events.delete({
        calendarId: getCalendarId(),
        eventId,
        sendUpdates: "none",
      });
    } catch (error) {
      const status = readGoogleCalendarErrorStatus(error);
      const message = readGoogleCalendarErrorMessage(error).toLowerCase();

      if (
        status === 404 ||
        message.includes("requested entity was not found") ||
        message.includes("not found")
      ) {
        return;
      }

      throw translateGoogleCalendarError("hold release", error);
    }
  }

  async getAttendeeResponseStatus(input: { eventId: string; candidateEmail: string }) {
    return this.run("attendee status lookup", async (calendar) => {
      const response = await calendar.events.get({
        calendarId: getCalendarId(),
        eventId: input.eventId,
      });

      const attendee = response.data.attendees?.find(
        (item) => item.email?.toLowerCase() === input.candidateEmail.toLowerCase(),
      );

      if (attendee?.responseStatus === "accepted") {
        return "ACCEPTED" as const;
      }

      if (attendee?.responseStatus === "declined") {
        return "DECLINED" as const;
      }

      return "NEEDS_ACTION" as const;
    });
  }
}

function assertCalendarConfiguration() {
  getCalendarId();

  if (getResolvedGoogleCalendarAuthMode() === "oauth-refresh") {
    return;
  }

  getServiceAccountEmail();
  getServiceAccountPrivateKey();
}

export function getCalendarService(): CalendarService {
  if (process.env.NODE_ENV === "test") {
    return new TestCalendarService();
  }

  assertCalendarConfiguration();
  return new GoogleCalendarService();
}
