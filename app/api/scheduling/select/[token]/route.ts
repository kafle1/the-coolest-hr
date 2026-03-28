import { NextResponse } from "next/server";

import { selectInterviewSlot } from "@/lib/applications/service";
import { errorToStatusCode, getErrorMessage } from "@/lib/utils/errors";

export async function POST(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await context.params;
    const application = await selectInterviewSlot(token);

    return NextResponse.json({
      ok: true,
      application,
    });
  } catch (error) {
    const message = getErrorMessage(error, "Unable to confirm the slot.");

    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: errorToStatusCode(error) },
    );
  }
}
