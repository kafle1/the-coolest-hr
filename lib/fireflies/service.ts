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

export interface TranscriptService {
  retrieveTranscript(input: {
    providerMeetingId?: string;
    directText?: string;
    candidateName: string;
    roleTitle: string;
  }): Promise<TranscriptPayload>;
}

class DirectTextTranscriptService implements TranscriptService {
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

    const response = await fetch("https://api.fireflies.ai/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.firefliesApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `
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
        variables: {
          transcriptId: input.providerMeetingId,
        },
      }),
    });

    if (!response.ok) {
      throw badRequest(
        `Fireflies returned ${response.status} when fetching the transcript.`,
        "fireflies_request_failed",
      );
    }

    const payload = (await response.json()) as {
      errors?: Array<{ message?: string }>;
      data?: {
        transcript?: {
          id?: string;
          summary?: {
            short_summary?: string;
            bullet_gist?: string[] | string | null;
            shorthand_bullet?: string[] | string | null;
          };
          sentences?: Array<{ text?: string }>;
        };
      };
    };
    const errorMessage = payload.errors?.find((error) => error.message)?.message;

    if (errorMessage) {
      throw badRequest(
        `Fireflies transcript fetch failed: ${errorMessage}`,
        "fireflies_transcript_failed",
      );
    }

    const transcript = payload.data?.transcript;

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
        transcript.summary?.short_summary ??
        `Interview completed for ${input.candidateName} (${input.roleTitle}).`,
      bulletPoints,
      fullText: (transcript.sentences ?? [])
        .map((sentence) => sentence.text)
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
