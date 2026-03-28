import { randomUUID } from "node:crypto";

import { google } from "googleapis";
import { addBusinessDays, addMinutes, isWeekend, setHours, setMinutes, startOfDay } from "date-fns";

import { env, requireValue } from "@/lib/utils/env";

export type CalendarSlot = {
  startsAt: Date;
  endsAt: Date;
};

export interface CalendarService {
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
  }): Promise<{ eventId: string; meetingUrl?: string }>;
  releaseHoldEvent(eventId: string): Promise<void>;
  getAttendeeResponseStatus(input: {
    eventId: string;
    candidateEmail: string;
  }): Promise<"NEEDS_ACTION" | "ACCEPTED" | "DECLINED">;
}

let googleCalendarUnavailable = false;

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

class LocalCalendarService implements CalendarService {
  async findAvailableSlots(input: { reserved: CalendarSlot[]; count: number }) {
    return buildCandidateSlots()
      .filter((slot) => !input.reserved.some((reserved) => overlaps(slot, reserved)))
      .slice(0, input.count);
  }

  async createHoldEvent(input: { holdId: string }) {
    return { eventId: `local-hold-${input.holdId}` };
  }

  async confirmHoldEvent(input: { eventId: string }) {
    return { eventId: input.eventId };
  }

  async releaseHoldEvent() {}

  async getAttendeeResponseStatus() {
    return "NEEDS_ACTION" as const;
  }
}

class GoogleCalendarService implements CalendarService {
  private readonly calendar = google.calendar({
    version: "v3",
    auth: new google.auth.JWT({
      email: requireValue("GOOGLE_SERVICE_ACCOUNT_EMAIL", env.googleServiceAccountEmail),
      key: requireValue(
        "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
        env.googleServiceAccountPrivateKey,
      ),
      scopes: ["https://www.googleapis.com/auth/calendar"],
    }),
  });

  async findAvailableSlots(input: { reserved: CalendarSlot[]; count: number }) {
    const candidates = buildCandidateSlots();
    const timeMin = candidates[0]?.startsAt;
    const timeMax = candidates.at(-1)?.endsAt;

    if (!timeMin || !timeMax) {
      return [];
    }

    const busyResponse = await this.calendar.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: requireValue("GOOGLE_CALENDAR_ID", env.googleCalendarId) }],
      },
    });

    const busyPeriods =
      busyResponse.data.calendars?.[env.googleCalendarId]?.busy?.map((item) => ({
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
  }

  async createHoldEvent(input: {
    holdId: string;
    applicationId: string;
    candidateName: string;
    roleTitle: string;
    startsAt: Date;
    endsAt: Date;
  }) {
    const response = await this.calendar.events.insert({
      calendarId: requireValue("GOOGLE_CALENDAR_ID", env.googleCalendarId),
      conferenceDataVersion: 1,
      requestBody: {
        summary: `Hold: ${input.candidateName} / ${input.roleTitle}`,
        description: "Tentative hold for candidate scheduling.",
        start: {
          dateTime: input.startsAt.toISOString(),
        },
        end: {
          dateTime: input.endsAt.toISOString(),
        },
        transparency: "opaque",
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
      },
    });

    return {
      eventId: response.data.id ?? input.holdId,
    };
  }

  async confirmHoldEvent(input: {
    eventId: string;
    candidateName: string;
    candidateEmail: string;
    roleTitle: string;
    startsAt: Date;
    endsAt: Date;
  }) {
    const response = await this.calendar.events.patch({
      calendarId: requireValue("GOOGLE_CALENDAR_ID", env.googleCalendarId),
      eventId: input.eventId,
      conferenceDataVersion: 1,
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
      sendUpdates: "all",
    });

    return {
      eventId: response.data.id ?? input.eventId,
      meetingUrl: response.data.hangoutLink ?? undefined,
    };
  }

  async releaseHoldEvent(eventId: string) {
    await this.calendar.events.delete({
      calendarId: requireValue("GOOGLE_CALENDAR_ID", env.googleCalendarId),
      eventId,
      sendUpdates: "none",
    });
  }

  async getAttendeeResponseStatus(input: { eventId: string; candidateEmail: string }) {
    const response = await this.calendar.events.get({
      calendarId: requireValue("GOOGLE_CALENDAR_ID", env.googleCalendarId),
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
  }
}

function readGoogleCalendarErrorStatus(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }

  const maybeError = error as {
    code?: number | string;
    status?: number;
    response?: {
      status?: number;
    };
  };

  if (typeof maybeError.status === "number") {
    return maybeError.status;
  }

  if (typeof maybeError.response?.status === "number") {
    return maybeError.response.status;
  }

  if (typeof maybeError.code === "number") {
    return maybeError.code;
  }

  return null;
}

function isRecoverableGoogleCalendarError(error: unknown) {
  const status = readGoogleCalendarErrorStatus(error);

  if (status !== null) {
    return [401, 403, 404].includes(status);
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return [
    "Not Found",
    "Requested entity was not found",
    "invalid_grant",
    "Login Required",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNREFUSED",
  ].some((pattern) => error.message.includes(pattern));
}

class FallbackCalendarService implements CalendarService {
  constructor(
    private readonly primary: CalendarService,
    private readonly fallback: CalendarService,
  ) {}

  private async runWithFallback<T>(
    action: (service: CalendarService) => Promise<T>,
    operation: string,
  ) {
    if (googleCalendarUnavailable) {
      return action(this.fallback);
    }

    try {
      return await action(this.primary);
    } catch (error) {
      if (!isRecoverableGoogleCalendarError(error)) {
        throw error;
      }

      googleCalendarUnavailable = true;
      const message =
        error instanceof Error ? error.message : "Unknown Google Calendar error.";
      console.warn(
        `[hiring-os] Falling back to local calendar mode after ${operation} failed: ${message}`,
      );

      return action(this.fallback);
    }
  }

  async findAvailableSlots(input: { reserved: CalendarSlot[]; count: number }) {
    return this.runWithFallback(
      (service) => service.findAvailableSlots(input),
      "calendar availability lookup",
    );
  }

  async createHoldEvent(input: {
    holdId: string;
    applicationId: string;
    candidateName: string;
    roleTitle: string;
    startsAt: Date;
    endsAt: Date;
  }) {
    return this.runWithFallback(
      (service) => service.createHoldEvent(input),
      "calendar hold creation",
    );
  }

  async confirmHoldEvent(input: {
    eventId: string;
    candidateName: string;
    candidateEmail: string;
    roleTitle: string;
    startsAt: Date;
    endsAt: Date;
  }) {
    return this.runWithFallback(
      (service) => service.confirmHoldEvent(input),
      "calendar event confirmation",
    );
  }

  async releaseHoldEvent(eventId: string) {
    return this.runWithFallback(
      (service) => service.releaseHoldEvent(eventId),
      "calendar hold release",
    );
  }

  async getAttendeeResponseStatus(input: { eventId: string; candidateEmail: string }) {
    return this.runWithFallback(
      (service) => service.getAttendeeResponseStatus(input),
      "calendar attendee status lookup",
    );
  }
}

function hasGoogleCalendarConfiguration() {
  return [env.googleCalendarId, env.googleServiceAccountEmail, env.googleServiceAccountPrivateKey].every(
    (value) => value.trim().length > 0,
  );
}

export function getCalendarService(): CalendarService {
  if (process.env.NODE_ENV === "test" || !hasGoogleCalendarConfiguration()) {
    return new LocalCalendarService();
  }

  if (googleCalendarUnavailable) {
    return new LocalCalendarService();
  }

  return new FallbackCalendarService(
    new GoogleCalendarService(),
    new LocalCalendarService(),
  );
}
