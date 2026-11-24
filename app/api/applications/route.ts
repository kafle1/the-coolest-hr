import { after, NextResponse } from "next/server";

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
    const { applicationId, confirmationEmailError } = await submitApplication(formData);
    console.info(
      `[hiring-os] ${new Date().toISOString()} application=${applicationId} intake="stored"`,
    );
    after(async () => {
      console.info(
        `[hiring-os] ${new Date().toISOString()} application=${applicationId} intake="initial-automation-started"`,
      );

      try {
        await runApplicationAutomation(applicationId);
        console.info(
          `[hiring-os] ${new Date().toISOString()} application=${applicationId} intake="initial-automation-finished"`,
        );
      } catch (automationError) {
        const message =
          automationError instanceof Error
            ? automationError.message
            : "Unknown automation error.";
        console.error(
          `[hiring-os] ${new Date().toISOString()} application=${applicationId} intake="initial-automation-failed" message="${message.replaceAll('"', "'")}"`,
        );
      }
    });

    return NextResponse.json({
      ok: true,
      applicationId,
      message: confirmationEmailError
        ? "Application submitted, but the confirmation email could not be delivered."
        : "Application submitted successfully. We will update you by email.",
      warning: confirmationEmailError ?? undefined,
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
