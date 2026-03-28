import { NextResponse } from "next/server";

import { generateOffer } from "@/lib/applications/service";
import { errorToStatusCode, getErrorMessage } from "@/lib/utils/errors";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const offer = await generateOffer(id, body);

    return NextResponse.json({
      ok: true,
      offer,
    });
  } catch (error) {
    const message = getErrorMessage(error, "Unable to generate offer.");

    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: errorToStatusCode(error) },
    );
  }
}
