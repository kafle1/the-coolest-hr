import { NextResponse } from "next/server";

import {
  buildSlackConnectUrl,
  canStartSlackCandidateConnect,
  createSlackConnectState,
  getSlackCandidateConnectSetupError,
  getSlackOAuthRedirectUri,
  getSlackRequestOrigin,
} from "@/lib/slack/oauth";
import { prisma } from "@/lib/prisma/client";

function getOfferRedirectUrl(request: Request, offerToken: string, slackState?: string) {
  const url = new URL(`/offers/sign/${offerToken}`, getSlackRequestOrigin(request));

  if (slackState) {
    url.searchParams.set("slack", slackState);
  }

  return url;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const offerToken = url.searchParams.get("offer")?.trim();

  if (!offerToken) {
    return NextResponse.json(
      { ok: false, message: "Offer token is required." },
      { status: 400 },
    );
  }

  const offer = await prisma.offer.findUnique({
    where: { token: offerToken },
    select: {
      status: true,
      token: true,
    },
  });

  if (!offer) {
    return NextResponse.redirect(getOfferRedirectUrl(request, offerToken, "failed"));
  }

  if (offer.status !== "SIGNED") {
    return NextResponse.redirect(getOfferRedirectUrl(request, offer.token, "failed"));
  }

  if (!canStartSlackCandidateConnect(request)) {
    const setupError = getSlackCandidateConnectSetupError(request);

    console.warn(
      `[hiring-os] ${new Date().toISOString()} offer=${offer.token} step="Slack connect start" ${
        setupError ?? "Slack candidate connect is not ready."
      }`,
    );

    return NextResponse.redirect(getOfferRedirectUrl(request, offer.token, "setup"));
  }

  const { nonce, state } = await createSlackConnectState(offer.token);
  const redirectUri = getSlackOAuthRedirectUri(request);

  return NextResponse.redirect(buildSlackConnectUrl({ state, nonce, redirectUri }));
}
