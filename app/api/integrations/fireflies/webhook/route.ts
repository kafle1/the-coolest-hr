import { NextResponse } from "next/server";

import { ingestTranscriptFromWebhook } from "@/lib/applications/service";
import { errorToStatusCode, getErrorMessage } from "@/lib/utils/errors";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      applicationId?: string;
      providerMeetingId?: string;
      meetingId?: string;
      directText?: string;
    };

    const applicationId = body.applicationId;
    const providerMeetingId = body.providerMeetingId ?? body.meetingId;
    const directText = body.directText;

    if (!applicationId) {
      throw new Error("applicationId is required.");
    }

    const result = await ingestTranscriptFromWebhook({
      applicationId,
      providerMeetingId,
      directText,
    });

    return NextResponse.json({
      ok: true,
      application: result.application,
      message: result.message,
    });
  } catch (error) {
    const message = getErrorMessage(error, "Unable to ingest transcript.");

    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: errorToStatusCode(error) },
    );
  }
}
