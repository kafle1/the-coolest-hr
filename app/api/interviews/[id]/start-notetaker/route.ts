import { NextResponse } from "next/server";

import { startInterviewNotetaker } from "@/lib/applications/service";
import { errorToStatusCode, getErrorMessage } from "@/lib/utils/errors";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const result = await startInterviewNotetaker(id);

    return NextResponse.json({
      ok: true,
      application: result.application,
      message: result.message,
    });
  } catch (error) {
    const message = getErrorMessage(error, "Unable to start Fireflies.");

    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: errorToStatusCode(error) },
    );
  }
}
