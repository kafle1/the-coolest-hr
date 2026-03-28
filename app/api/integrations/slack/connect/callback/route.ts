import { NextResponse } from "next/server";

import { completeSlackOnboarding } from "@/lib/offers/service";
import {
  exchangeSlackConnectCode,
  fetchSlackConnectIdentity,
  verifySlackConnectState,
  verifySlackIdToken,
} from "@/lib/slack/oauth";
import { prisma } from "@/lib/prisma/client";
import { env } from "@/lib/utils/env";

function buildOfferRedirectUrl(offerToken: string, slackState: "connected" | "failed") {
  const url = new URL(`/offers/sign/${offerToken}`, env.appUrl);
  url.searchParams.set("slack", slackState);

  return url;
}

async function handleSlackConnectCallback(request: Request, body?: FormData) {
  const url = new URL(request.url);
  const code =
    body?.get("code")?.toString().trim() ?? url.searchParams.get("code")?.trim() ?? "";
  const state =
    body?.get("state")?.toString().trim() ?? url.searchParams.get("state")?.trim() ?? "";
  const error =
    body?.get("error")?.toString().trim() ?? url.searchParams.get("error")?.trim() ?? "";

  const verifiedState = state ? await verifySlackConnectState(state) : null;
  const fallbackToken = verifiedState?.offerToken || "";

  if (error || !verifiedState || !code) {
    const failureTarget = fallbackToken ? buildOfferRedirectUrl(fallbackToken, "failed") : env.appUrl;
    return NextResponse.redirect(failureTarget);
  }

  try {
    const offer = await prisma.offer.findUnique({
      where: { token: verifiedState.offerToken },
      include: {
        application: {
          select: {
            email: true,
          },
        },
      },
    });

    if (!offer || offer.status !== "SIGNED") {
      return NextResponse.redirect(buildOfferRedirectUrl(verifiedState.offerToken, "failed"));
    }

    const tokens = await exchangeSlackConnectCode(code);
    verifySlackIdToken({
      idToken: tokens.idToken,
      expectedNonce: verifiedState.nonce,
    });

    const identity = await fetchSlackConnectIdentity(tokens.accessToken);

    if (identity.email !== offer.application.email.toLowerCase()) {
      return NextResponse.redirect(buildOfferRedirectUrl(verifiedState.offerToken, "failed"));
    }

    await completeSlackOnboarding({
      email: identity.email,
      slackUserId: identity.slackUserId,
    });

    return NextResponse.redirect(buildOfferRedirectUrl(verifiedState.offerToken, "connected"));
  } catch (error) {
    console.error(
      `[hiring-os] ${new Date().toISOString()} offer=${verifiedState.offerToken} step="Slack connect callback" ${
        error instanceof Error ? error.message : "Slack onboarding failed during callback."
      }`,
    );
    return NextResponse.redirect(buildOfferRedirectUrl(verifiedState.offerToken, "failed"));
  }
}

export async function GET(request: Request) {
  return handleSlackConnectCallback(request);
}

export async function POST(request: Request) {
  return handleSlackConnectCallback(request, await request.formData());
}
