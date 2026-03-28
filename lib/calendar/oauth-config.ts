import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { google } from "googleapis";

import { createSessionToken, verifySessionToken } from "@/lib/auth/session-token";
import { env, requireValue } from "@/lib/utils/env";

const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const OAUTH_CONFIG_PATH = path.join(process.cwd(), "data", "google-calendar-oauth.json");
const ENV_FILE_PATH = path.join(process.cwd(), ".env");

type PersistedGoogleCalendarOAuthConfig = {
  calendarId: string;
  connectedAt: string;
  connectedEmail?: string;
  refreshToken: string;
};

export type GoogleCalendarConnectionState = {
  authMode: "service-account" | "oauth-refresh";
  calendarId?: string;
  connected: boolean;
  connectedAt?: string;
  connectedEmail?: string;
  connectUrl: string;
  reason:
    | "service-account"
    | "missing-oauth-client"
    | "missing-refresh-token"
    | "missing-calendar-id"
    | "ready";
};

type CalendarListEntry = {
  accessRole?: string | null;
  id?: string | null;
  primary?: boolean | null;
  summary?: string | null;
};

function isUserEmailCalendarId(value: string) {
  return value.includes("@") && !value.endsWith("@group.calendar.google.com");
}

function normalizeUrl(value: string) {
  return value.replace(/\/$/, "");
}

export function getGoogleCalendarOAuthRedirectUri() {
  return `${normalizeUrl(env.appUrl)}/api/integrations/google-calendar/callback`;
}

export function getGoogleCalendarConnectUrl() {
  return `${normalizeUrl(env.appUrl)}/api/integrations/google-calendar/connect`;
}

function readPersistedOAuthConfigFile(): PersistedGoogleCalendarOAuthConfig | null {
  if (!existsSync(OAUTH_CONFIG_PATH)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(OAUTH_CONFIG_PATH, "utf8")) as
      | PersistedGoogleCalendarOAuthConfig
      | null;

    if (!parsed?.refreshToken?.trim() || !parsed.calendarId?.trim()) {
      return null;
    }

    return {
      refreshToken: parsed.refreshToken.trim(),
      calendarId: parsed.calendarId.trim(),
      connectedEmail: parsed.connectedEmail?.trim() || undefined,
      connectedAt: parsed.connectedAt,
    };
  } catch {
    return null;
  }
}

export function getResolvedGoogleCalendarAuthMode() {
  return readPersistedOAuthConfigFile() ? "oauth-refresh" : env.googleCalendarAuthMode;
}

export function getResolvedGoogleCalendarId() {
  const persisted = readPersistedOAuthConfigFile();
  return persisted?.calendarId || env.googleCalendarId;
}

export function getResolvedGoogleCalendarRefreshToken() {
  const persisted = readPersistedOAuthConfigFile();
  return persisted?.refreshToken || env.googleOAuthRefreshToken;
}

export function getGoogleCalendarConnectionState(): GoogleCalendarConnectionState {
  const persisted = readPersistedOAuthConfigFile();
  const authMode = getResolvedGoogleCalendarAuthMode();
  const calendarId = getResolvedGoogleCalendarId()?.trim() || undefined;
  const refreshToken = getResolvedGoogleCalendarRefreshToken()?.trim() || "";
  const hasOAuthClient =
    env.googleOAuthClientId.trim().length > 0 && env.googleOAuthClientSecret.trim().length > 0;

  if (authMode !== "oauth-refresh") {
    return {
      authMode,
      calendarId,
      connected: false,
      connectUrl: getGoogleCalendarConnectUrl(),
      reason: "service-account",
    };
  }

  if (!hasOAuthClient) {
    return {
      authMode,
      calendarId,
      connected: false,
      connectUrl: getGoogleCalendarConnectUrl(),
      reason: "missing-oauth-client",
    };
  }

  if (!refreshToken) {
    return {
      authMode,
      calendarId,
      connected: false,
      connectUrl: getGoogleCalendarConnectUrl(),
      reason: "missing-refresh-token",
    };
  }

  if (!calendarId) {
    return {
      authMode,
      connected: false,
      connectUrl: getGoogleCalendarConnectUrl(),
      reason: "missing-calendar-id",
    };
  }

  return {
    authMode,
    calendarId,
    connected: true,
    connectedAt: persisted?.connectedAt,
    connectedEmail: persisted?.connectedEmail,
    connectUrl: getGoogleCalendarConnectUrl(),
    reason: "ready",
  };
}

function writePersistedOAuthConfig(config: PersistedGoogleCalendarOAuthConfig) {
  mkdirSync(path.dirname(OAUTH_CONFIG_PATH), { recursive: true });
  writeFileSync(OAUTH_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function quoteEnvValue(value: string) {
  return JSON.stringify(value);
}

function upsertEnvFile(updates: Record<string, string>) {
  const existing = existsSync(ENV_FILE_PATH) ? readFileSync(ENV_FILE_PATH, "utf8") : "";
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];

  for (const [key, value] of Object.entries(updates)) {
    const nextLine = `${key}=${quoteEnvValue(value)}`;
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));

    if (index >= 0) {
      lines[index] = nextLine;
      continue;
    }

    lines.push(nextLine);
  }

  const output = lines.filter((line, index, array) => index < array.length - 1 || line.length > 0);
  writeFileSync(ENV_FILE_PATH, `${output.join("\n")}\n`, "utf8");
}

function buildOAuthClient() {
  return new google.auth.OAuth2(
    requireValue("GOOGLE_OAUTH_CLIENT_ID", env.googleOAuthClientId),
    requireValue("GOOGLE_OAUTH_CLIENT_SECRET", env.googleOAuthClientSecret),
    getGoogleCalendarOAuthRedirectUri(),
  );
}

export function createGoogleCalendarOAuthState() {
  return createSessionToken(`google-calendar-oauth:${randomUUID()}`);
}

export async function verifyGoogleCalendarOAuthState(state: string) {
  const value = await verifySessionToken(state);
  return typeof value === "string" && value.startsWith("google-calendar-oauth:");
}

export function buildGoogleCalendarAuthUrl(state: string) {
  const client = buildOAuthClient();

  return client.generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    prompt: "consent",
    scope: [GOOGLE_CALENDAR_SCOPE],
    state,
  });
}

export function pickDefaultGoogleCalendar(calendars: CalendarListEntry[]) {
  const writableCalendars = calendars.filter(
    (calendar) =>
      calendar.id?.trim() &&
      (calendar.accessRole === "owner" || calendar.accessRole === "writer"),
  );

  const primaryCalendar = writableCalendars.find((calendar) => calendar.primary);
  if (primaryCalendar?.id) {
    return {
      calendarId: primaryCalendar.id,
      connectedEmail: isUserEmailCalendarId(primaryCalendar.id)
        ? primaryCalendar.id
        : undefined,
      summary: primaryCalendar.summary?.trim() || primaryCalendar.id,
    };
  }

  const emailCalendar = writableCalendars.find(
    (calendar) => calendar.id && isUserEmailCalendarId(calendar.id),
  );
  if (emailCalendar?.id) {
    return {
      calendarId: emailCalendar.id,
      connectedEmail: emailCalendar.id,
      summary: emailCalendar.summary?.trim() || emailCalendar.id,
    };
  }

  const fallbackCalendar = writableCalendars[0];
  if (!fallbackCalendar?.id) {
    return null;
  }

  return {
    calendarId: fallbackCalendar.id,
    connectedEmail: undefined,
    summary: fallbackCalendar.summary?.trim() || fallbackCalendar.id,
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

async function verifyCalendarMeetAccess(
  client: ReturnType<typeof buildOAuthClient>,
  calendarId: string,
) {
  const calendar = google.calendar({
    version: "v3",
    auth: client,
  });
  const startsAt = new Date(Date.now() + 60 * 60 * 1000);
  const endsAt = new Date(Date.now() + 90 * 60 * 1000);
  const response = await calendar.events.insert({
    calendarId,
    conferenceDataVersion: 1,
    sendUpdates: "none",
    requestBody: {
      summary: "Niural Google Calendar verification",
      start: {
        dateTime: startsAt.toISOString(),
      },
      end: {
        dateTime: endsAt.toISOString(),
      },
      conferenceData: {
        createRequest: {
          requestId: `niural-verify-${Date.now()}`,
          conferenceSolutionKey: {
            type: "hangoutsMeet",
          },
        },
      },
    },
  });

  const eventId = response.data.id?.trim();
  const meetingUrl = extractMeetingUrl(response.data);

  if (eventId) {
    await calendar.events.delete({
      calendarId,
      eventId,
      sendUpdates: "none",
    }).catch(() => undefined);
  }

  if (!meetingUrl) {
    throw new Error("Google connected successfully, but the selected calendar did not return a Meet link.");
  }

  return {
    meetingUrl,
  };
}

export async function completeGoogleCalendarOAuthConnection(code: string) {
  const client = buildOAuthClient();
  const tokenResponse = await client.getToken(code);
  const refreshToken = tokenResponse.tokens.refresh_token?.trim();

  if (!refreshToken) {
    throw new Error(
      "Google did not return a refresh token. Remove the app connection from your Google account and approve the consent screen again.",
    );
  }

  client.setCredentials({
    refresh_token: refreshToken,
  });

  const calendar = google.calendar({
    version: "v3",
    auth: client,
  });
  const calendarList = await calendar.calendarList.list();
  const selectedCalendar = pickDefaultGoogleCalendar(calendarList.data.items ?? []);

  if (!selectedCalendar) {
    throw new Error("Google connected, but no writable calendar was available for scheduling.");
  }

  const verification = await verifyCalendarMeetAccess(client, selectedCalendar.calendarId);
  const connectedAt = new Date().toISOString();

  writePersistedOAuthConfig({
    refreshToken,
    calendarId: selectedCalendar.calendarId,
    connectedEmail: selectedCalendar.connectedEmail,
    connectedAt,
  });

  upsertEnvFile({
    GOOGLE_CALENDAR_AUTH_MODE: "oauth-refresh",
    GOOGLE_OAUTH_CLIENT_ID: env.googleOAuthClientId,
    GOOGLE_OAUTH_CLIENT_SECRET: env.googleOAuthClientSecret,
    GOOGLE_OAUTH_REFRESH_TOKEN: refreshToken,
    GOOGLE_CALENDAR_ID: selectedCalendar.calendarId,
    ...(selectedCalendar.connectedEmail
      ? { INTERVIEWER_EMAIL: selectedCalendar.connectedEmail }
      : {}),
  });

  return {
    calendarId: selectedCalendar.calendarId,
    calendarSummary: selectedCalendar.summary,
    connectedAt,
    connectedEmail: selectedCalendar.connectedEmail,
    meetingUrl: verification.meetingUrl,
  };
}
