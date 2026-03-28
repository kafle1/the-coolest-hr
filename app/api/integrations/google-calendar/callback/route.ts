import { NextResponse } from "next/server";

import {
  completeGoogleCalendarOAuthConnection,
  verifyGoogleCalendarOAuthState,
} from "@/lib/calendar/oauth-config";
import { resumePendingInterviewScheduling } from "@/lib/applications/service";
import { env } from "@/lib/utils/env";

function renderHtml(title: string, body: string) {
  return new NextResponse(
    `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f4f6fb;
        color: #111827;
      }
      main {
        width: min(640px, calc(100vw - 32px));
        background: #ffffff;
        border: 1px solid #dbe3f0;
        border-radius: 20px;
        padding: 28px;
        box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 24px;
      }
      p {
        margin: 0 0 12px;
        line-height: 1.6;
      }
      code {
        display: inline-block;
        padding: 2px 6px;
        background: #eef2ff;
        border-radius: 8px;
      }
      a {
        color: #1d4ed8;
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      ${body}
    </main>
  </body>
</html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    },
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim();
  const state = url.searchParams.get("state")?.trim();
  const error = url.searchParams.get("error")?.trim();

  if (error) {
    return renderHtml(
      "Google Calendar Connection Failed",
      `<p>Google returned <code>${error}</code>. Please try the connection again from the admin workspace.</p><p><a href="${env.appUrl}/admin">Back to admin</a></p>`,
    );
  }

  if (!code || !state || !(await verifyGoogleCalendarOAuthState(state))) {
    return renderHtml(
      "Google Calendar Connection Failed",
      `<p>The Google OAuth response could not be validated. Please start the connection again from the admin workspace.</p><p><a href="${env.appUrl}/admin">Back to admin</a></p>`,
    );
  }

  try {
    const result = await completeGoogleCalendarOAuthConnection(code);
    const resumeResult = await resumePendingInterviewScheduling();

    return renderHtml(
      "Google Calendar Connected",
      `<p>Your real Google Calendar is now connected for interview scheduling.</p>
       <p>Calendar: <code>${result.calendarId}</code></p>
       ${
         result.connectedEmail
           ? `<p>Organizer: <code>${result.connectedEmail}</code></p>`
           : ""
       }
       <p>Meet verification link created successfully.</p>
       <p>${resumeResult.resumedCount > 0 ? `Scheduling resumed for ${resumeResult.resumedCount} shortlisted candidate${resumeResult.resumedCount === 1 ? "" : "s"}.` : "No shortlisted candidates were waiting for scheduling."}</p>
       <p><a href="${env.appUrl}/admin">Return to admin</a></p>`,
    );
  } catch (connectionError) {
    const message =
      connectionError instanceof Error
        ? connectionError.message
        : "An unexpected error occurred while connecting Google Calendar.";

    return renderHtml(
      "Google Calendar Connection Failed",
      `<p>${message}</p><p><a href="${env.appUrl}/admin">Back to admin</a></p>`,
    );
  }
}
