import { NextResponse } from "next/server";

import {
  runApplicationAutomation,
  submitApplication,
} from "@/lib/applications/service";
import { errorToStatusCode, getErrorMessage } from "@/lib/utils/errors";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";

export const maxDuration = 60;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`apply:${ip}`, 5, 60_000);

  if (!limit.success) {
    return NextResponse.json(
      { ok: false, message: "Too many submissions. Please try again later." },
      { status: 429 },
    );
  }

  try {
    const formData = await request.formData();
    console.info(
      `[hiring-os] ${new Date().toISOString()} intake="received" ip=${ip}`,
    );
    const applicationId = await submitApplication(formData);
    console.info(
      `[hiring-os] ${new Date().toISOString()} application=${applicationId} intake="stored"`,
    );
    void runApplicationAutomation(applicationId)
      .then(() => {
        console.info(
          `[hiring-os] ${new Date().toISOString()} application=${applicationId} intake="initial-automation-finished"`,
        );
      })
      .catch((automationError) => {
        console.error(
          `[hiring-os] ${new Date().toISOString()} application=${applicationId} automation="failed"`,
          automationError,
        );
      });

    return NextResponse.json({
      ok: true,
      applicationId,
      message: "Application received. We will email you as your application moves forward.",
    });
  } catch (error) {
    console.error("[hiring-os] intake request failed", error);
    const message = getErrorMessage(error, "Unable to submit application.");
    console.error(
      `[hiring-os] ${new Date().toISOString()} intake="failed" ip=${ip} message="${message}"`,
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
