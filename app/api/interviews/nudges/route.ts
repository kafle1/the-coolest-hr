import { NextResponse } from "next/server";

import { processInterviewSchedulingNudges } from "@/lib/applications/service";

export async function POST() {
  try {
    const result = await processInterviewSchedulingNudges();

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to process scheduling nudges.",
      },
      { status: 400 },
    );
  }
}
