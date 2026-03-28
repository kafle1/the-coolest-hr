import { NextResponse } from "next/server";

import {
  buildSlackConnectUrl,
  canUseSlackCandidateConnect,
  createSlackConnectState,
} from "@/lib/slack/oauth";
import { prisma } from "@/lib/prisma/client";
import { env } from "@/lib/utils/env";

function getOfferRedirectUrl(offerToken: string, slackState?: string) {
  const url = new URL(`/offers/sign/${offerToken}`, env.appUrl);

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
    return NextResponse.redirect(getOfferRedirectUrl(offerToken, "failed"));
  }

  if (offer.status !== "SIGNED") {
    return NextResponse.redirect(getOfferRedirectUrl(offer.token, "failed"));
  }

  if (!canUseSlackCandidateConnect()) {
    return NextResponse.redirect(getOfferRedirectUrl(offer.token, "failed"));
  }

  const { nonce, state } = await createSlackConnectState(offer.token);

  return NextResponse.redirect(buildSlackConnectUrl({ state, nonce }));
}
