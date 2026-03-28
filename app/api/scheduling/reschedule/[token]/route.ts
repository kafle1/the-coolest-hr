import { NextResponse } from "next/server";

import { requestInterviewReschedule } from "@/lib/applications/service";
import { errorToStatusCode, getErrorMessage } from "@/lib/utils/errors";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await context.params;
    const body = await request.json();
    const applicationId = await requestInterviewReschedule(token, body);

    return NextResponse.json({
      ok: true,
      applicationId,
      message: "Your request was sent to the interviewer. New options can be issued after approval.",
    });
  } catch (error) {
    const message = getErrorMessage(error, "Unable to request a reschedule.");

    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: errorToStatusCode(error) },
    );
  }
}
