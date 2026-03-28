import { NextResponse } from "next/server";

import { sendInterviewOptions } from "@/lib/applications/service";
import { errorToStatusCode, getErrorMessage } from "@/lib/utils/errors";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const holds = await sendInterviewOptions(id);

    return NextResponse.json({
      ok: true,
      holds,
    });
  } catch (error) {
    const message = getErrorMessage(error, "Unable to send scheduling options.");

    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: errorToStatusCode(error) },
    );
  }
}
