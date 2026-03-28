import { NextResponse } from "next/server";

import { overrideApplicationDecision } from "@/lib/applications/service";
import { errorToStatusCode, getErrorMessage } from "@/lib/utils/errors";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const application = await overrideApplicationDecision(id, body);

    return NextResponse.json({
      ok: true,
      application,
    });
  } catch (error) {
    const message = getErrorMessage(error, "Unable to override application status.");

    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: errorToStatusCode(error) },
    );
  }
}
