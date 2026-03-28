import { NextResponse } from "next/server";

import { scheduleApprovedInterviewTime } from "@/lib/applications/service";
import { errorToStatusCode, getErrorMessage } from "@/lib/utils/errors";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const application = await scheduleApprovedInterviewTime(id, body);

    return NextResponse.json({
      ok: true,
      application,
      message: "Approved interview time scheduled.",
    });
  } catch (error) {
    const message = getErrorMessage(
      error,
      "Unable to schedule the approved interview time.",
    );

    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: errorToStatusCode(error) },
    );
  }
}
