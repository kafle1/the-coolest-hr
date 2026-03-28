import { NextResponse } from "next/server";

import { completeSlackOnboarding } from "@/lib/offers/service";
import { getSlackService } from "@/lib/slack/service";

type SlackEventPayload = {
  challenge?: string;
  event?: {
    type?: string;
    user?: {
      id?: string;
      profile?: {
        email?: string;
      };
    };
  };
};

export async function POST(request: Request) {
  const rawBody = await request.text();
  const slack = getSlackService();
  const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
  const signature = request.headers.get("x-slack-signature") ?? "";

  if (!slack.verifyRequestSignature({ rawBody, timestamp, signature })) {
    return NextResponse.json({ ok: false, message: "Invalid Slack signature." }, { status: 401 });
  }

  let body: SlackEventPayload;

  try {
    body = JSON.parse(rawBody) as SlackEventPayload;
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid Slack payload." }, { status: 400 });
  }

  if (body.challenge) {
    return NextResponse.json({ challenge: body.challenge });
  }

  if (body.event?.type === "team_join") {
    const slackUserId = body.event.user?.id;
    const email =
      body.event.user?.profile?.email ??
      (slackUserId ? await slack.getUserEmail(slackUserId) : null);

    if (email && slackUserId) {
      try {
        await completeSlackOnboarding({ email, slackUserId });
      } catch {
        // Non-applicant team_join events are expected — return 200 so Slack stops retrying.
      }
    }
  }

  return NextResponse.json({ ok: true });
}
