import { NextResponse } from "next/server";

import {
  buildGoogleCalendarAuthUrl,
  createGoogleCalendarOAuthState,
} from "@/lib/calendar/oauth-config";

export async function GET() {
  const state = await createGoogleCalendarOAuthState();

  return NextResponse.redirect(buildGoogleCalendarAuthUrl(state));
}
