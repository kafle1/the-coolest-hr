import { env } from "@/lib/utils/env";
import { badRequest, notFound } from "@/lib/utils/errors";

export type TranscriptPayload = {
  provider: string;
  providerMeetingId?: string;
  summary: string;
  bulletPoints: string[];
  fullText: string;
  retrievedAt: Date;
};

type LiveMeetingAttendee = {
  email?: string;
  phoneNumber?: string;
  displayName?: string;
};

type LiveMeetingCapturePayload = {
  message: string;
  providerMeetingId?: string;
  requestedAt: Date;
  state?: string;
};

type LiveMeetingStatus = {
  meetingLink: string;
  organizerEmail?: string | null;
  providerMeetingId: string;
  state?: string | null;
  title?: string | null;
};

export interface TranscriptService {
  startLiveMeetingCapture(input: {
    attendees: LiveMeetingAttendee[];
    durationMinutes: number;
    meetingLink: string;
    title: string;
  }): Promise<LiveMeetingCapturePayload>;
  findLiveMeetingByLink(input: { meetingLink: string }): Promise<LiveMeetingStatus | null>;
  retrieveTranscript(input: {
    providerMeetingId?: string;
    directText?: string;
    candidateName: string;
    roleTitle: string;
  }): Promise<TranscriptPayload>;
}

type FirefliesGraphqlPayload<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

function sleep(durationMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function normalizeMeetingLink(value: string) {
  const trimmed = value.trim();

  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return trimmed.replace(/\/$/, "");
  }
}

async function readFirefliesFailureMessage(response: Response) {
  const contentType = response.headers?.get?.("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const payload = (await response.json()) as FirefliesGraphqlPayload<unknown>;
      const message = payload.errors?.find((error) => error.message?.trim())?.message?.trim();

      if (message) {
        return message;
      }
    } catch {
      return null;
    }
  }

  try {
    const message = (await response.text()).trim();
    return message || null;
  } catch {
    return null;
  }
}

async function requestFireflies<T>(
  query: string,
  variables?: Record<string, unknown>,
  failureAction = "calling the API",
) {
  const response = await fetch("https://api.fireflies.ai/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.firefliesApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  if (!response.ok) {
    const detail = await readFirefliesFailureMessage(response);

    throw badRequest(
      detail
        ? `Fireflies returned ${response.status} when ${failureAction}: ${detail}`
        : `Fireflies returned ${response.status} when ${failureAction}.`,
      "fireflies_request_failed",
    );
  }

  const payload = (await response.json()) as FirefliesGraphqlPayload<T>;
  const errorMessage = payload.errors?.find((error) => error.message?.trim())?.message?.trim();

  if (errorMessage) {
    throw badRequest(`Fireflies API error: ${errorMessage}`, "fireflies_request_failed");
  }

  if (!payload.data) {
    throw badRequest("Fireflies returned an empty response.", "fireflies_response_empty");
  }

  return payload.data;
}

class DirectTextTranscriptService implements TranscriptService {
  async startLiveMeetingCapture(): Promise<LiveMeetingCapturePayload> {
    throw badRequest(
      "Fireflies API key is not configured. Add FIREFLIES_API_KEY to start the live notetaker.",
      "fireflies_not_configured",
    );
  }

  async findLiveMeetingByLink(): Promise<LiveMeetingStatus | null> {
    throw badRequest(
      "Fireflies API key is not configured. Add FIREFLIES_API_KEY to sync live meeting state.",
      "fireflies_not_configured",
    );
  }

  async retrieveTranscript(input: {
    providerMeetingId?: string;
    directText?: string;
    candidateName: string;
    roleTitle: string;
  }) {
    if (!input.directText) {
      throw badRequest(
        "Fireflies API key is not configured. Paste the transcript text directly.",
        "fireflies_not_configured",
      );
    }

    return {
      provider: "direct-input",
      providerMeetingId: input.providerMeetingId,
      summary: `Interview transcript for ${input.candidateName} (${input.roleTitle}).`,
      bulletPoints: [],
      fullText: input.directText,
      retrievedAt: new Date(),
    };
  }
}

class FirefliesTranscriptService implements TranscriptService {
  private async findLiveMeetingByLinkOnce(input: { meetingLink: string }) {
    const normalizedMeetingLink = normalizeMeetingLink(input.meetingLink);
    const data = await requestFireflies<{
      active_meetings?: Array<{
        id?: string | null;
        meeting_link?: string | null;
        organizer_email?: string | null;
        state?: string | null;
        title?: string | null;
      }>;
    }>(`
      query ActiveMeetings {
        active_meetings {
          id
          meeting_link
          organizer_email
          state
          title
        }
      }
    `,
    undefined,
    "loading active meetings",
    );

    const meeting = data.active_meetings?.find(
      (candidate) =>
        candidate.id?.trim() &&
        candidate.meeting_link &&
        normalizeMeetingLink(candidate.meeting_link) === normalizedMeetingLink,
    );

    if (!meeting?.id || !meeting.meeting_link) {
      return null;
    }

    return {
      meetingLink: meeting.meeting_link,
      organizerEmail: meeting.organizer_email,
      providerMeetingId: meeting.id,
      state: meeting.state,
      title: meeting.title,
    };
  }

  private async waitForLiveMeeting(
    input: { meetingLink: string },
    attempts = 4,
    delayMs = 2_000,
  ) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const meeting = await this.findLiveMeetingByLinkOnce(input);

      if (meeting) {
        return meeting;
      }

      if (attempt < attempts - 1) {
        await sleep(delayMs);
      }
    }

    return null;
  }

  async startLiveMeetingCapture(input: {
    attendees: LiveMeetingAttendee[];
    durationMinutes: number;
    meetingLink: string;
    title: string;
  }) {
    const requestedAt = new Date();
    const normalizedMeetingLink = normalizeMeetingLink(input.meetingLink);
    const data = await requestFireflies<{
      addToLiveMeeting?: {
        message?: string | null;
        success?: boolean | null;
      };
    }>(
      `
        mutation AddToLiveMeeting(
          $attendees: [AttendeeInput!]
          $duration: Int
          $language: String
          $meetingLink: String!
          $title: String
        ) {
          addToLiveMeeting(
            meeting_link: $meetingLink
            title: $title
            duration: $duration
            language: $language
            attendees: $attendees
          ) {
            message
            success
          }
        }
      `,
      {
        attendees: input.attendees.filter(
          (attendee) => attendee.email || attendee.phoneNumber || attendee.displayName,
        ),
        duration: input.durationMinutes,
        language: "en",
        meetingLink: normalizedMeetingLink,
        title: input.title,
      },
      "starting the live meeting",
    );

    const result = data.addToLiveMeeting;

    if (!result?.success) {
      throw badRequest(
        result?.message?.trim() || "Fireflies rejected the live meeting request.",
        "fireflies_live_meeting_failed",
      );
    }

    const liveMeeting = await this.waitForLiveMeeting({
      meetingLink: normalizedMeetingLink,
    }).catch(() => null);

    return {
      message: result.message?.trim() || "Fireflies is joining the meeting.",
      providerMeetingId: liveMeeting?.providerMeetingId,
      requestedAt,
      state: liveMeeting?.state ?? "REQUESTED",
    };
  }

  async findLiveMeetingByLink(input: { meetingLink: string }) {
    return this.findLiveMeetingByLinkOnce(input);
  }

  async retrieveTranscript(input: {
    providerMeetingId?: string;
    directText?: string;
    candidateName: string;
    roleTitle: string;
  }) {
    if (input.directText) {
      return {
        provider: "direct-input",
        providerMeetingId: input.providerMeetingId,
        summary: `Interview transcript for ${input.candidateName} (${input.roleTitle}).`,
        bulletPoints: [],
        fullText: input.directText,
        retrievedAt: new Date(),
      };
    }

    if (!input.providerMeetingId) {
      throw badRequest(
        "Provide either a Fireflies meeting ID or paste the transcript text.",
        "missing_transcript_source",
      );
    }

    const data = await requestFireflies<{
      transcript?: {
        id?: string | null;
        sentences?: Array<{ text?: string | null }> | null;
        summary?: {
          bullet_gist?: string[] | string | null;
          short_summary?: string | null;
          shorthand_bullet?: string[] | string | null;
        } | null;
      } | null;
    }>(
      `
        query Transcript($transcriptId: String!) {
          transcript(id: $transcriptId) {
            id
            summary {
              short_summary
              bullet_gist
              shorthand_bullet
            }
            sentences {
              text
            }
          }
        }
      `,
      {
        transcriptId: input.providerMeetingId,
      },
      "fetching the transcript",
    );

    const transcript = data.transcript;

    if (!transcript) {
      throw notFound("Transcript not found in Fireflies response.", "transcript_not_found");
    }

    const bulletPoints = [transcript.summary?.bullet_gist, transcript.summary?.shorthand_bullet]
      .flatMap((value) => {
        if (Array.isArray(value)) {
          return value;
        }

        if (typeof value === "string") {
          return value
            .split(/\n+/)
            .map((item) => item.trim())
            .filter(Boolean);
        }

        return [];
      });

    return {
      provider: "fireflies",
      providerMeetingId: transcript.id ?? input.providerMeetingId,
      summary:
        transcript.summary?.short_summary?.trim() ||
        `Interview completed for ${input.candidateName} (${input.roleTitle}).`,
      bulletPoints,
      fullText: (transcript.sentences ?? [])
        .map((sentence) => sentence.text?.trim())
        .filter(Boolean)
        .join(" "),
      retrievedAt: new Date(),
    };
  }
}

export function getTranscriptService(): TranscriptService {
  if (!env.firefliesApiKey) {
    return new DirectTextTranscriptService();
  }

  return new FirefliesTranscriptService();
}
