import { NextResponse } from "next/server";
import { OnboardingEventType } from "@prisma/client";

import { signOffer } from "@/lib/offers/service";
import {
  getSlackCandidateConnectSetupError,
  getSlackCandidateConnectStartPath,
} from "@/lib/slack/oauth";
import { errorToStatusCode, getErrorMessage } from "@/lib/utils/errors";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      signerName?: string;
      signatureDataUrl?: string;
    };
    const signerName = body.signerName?.trim();

    if (!signerName || !body.signatureDataUrl) {
      throw new Error("Signer name and signature are required.");
    }

    if (!/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(body.signatureDataUrl)) {
      throw new Error("Signature must be a valid PNG image.");
    }

    const forwardedFor = request.headers.get("x-forwarded-for");
    const signerIp = forwardedFor?.split(",")[0]?.trim() ?? "127.0.0.1";

    const offer = await signOffer({
      offerId: id,
      signerName,
      signatureDataUrl: body.signatureDataUrl,
      signerIp,
    });
    const hasSlackConnectReady = offer.application.onboardingEvents.some(
      (event) => event.type === OnboardingEventType.SLACK_CONNECT_READY,
    );
    const slackSetupError = hasSlackConnectReady
      ? getSlackCandidateConnectSetupError(request)
      : null;
    const onboardingUrl = hasSlackConnectReady
      && !slackSetupError
      ? getSlackCandidateConnectStartPath(offer.token)
      : null;
    const message = onboardingUrl
      ? "Offer signed successfully. Redirecting to Slack onboarding..."
      : slackSetupError
        ? "Offer signed successfully. Slack onboarding is ready, but it needs a public HTTPS callback before it can continue."
        : "Offer signed successfully.";

    return NextResponse.json({
      ok: true,
      message,
      onboardingUrl,
      slackSetupError,
      offer,
    });
  } catch (error) {
    const message = getErrorMessage(error, "Unable to sign the offer.");

    return NextResponse.json(
      {
        ok: false,
        message,
      },
      { status: errorToStatusCode(error) },
    );
  }
}
