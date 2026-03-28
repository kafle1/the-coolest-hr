import { NextResponse } from "next/server";

import { submitInterviewFeedback } from "@/lib/applications/service";
import { errorToStatusCode, getErrorMessage } from "@/lib/utils/errors";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const review = await submitInterviewFeedback(id, body);

    return NextResponse.json({
      ok: true,
      review,
    });
  } catch (error) {
    const message = getErrorMessage(error, "Unable to store feedback.");

    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: errorToStatusCode(error) },
    );
  }
}
