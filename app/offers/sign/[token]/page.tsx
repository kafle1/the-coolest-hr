import Link from "next/link";
import { notFound } from "next/navigation";
import { OnboardingEventType } from "@prisma/client";

import { OfferSignForm } from "@/components/offer-sign-form";
import { SectionCard } from "@/components/section-card";
import { prisma } from "@/lib/prisma/client";
import {
  canUseSlackCandidateConnect,
  getSlackCandidateConnectStartPath,
} from "@/lib/slack/oauth";

export const dynamic = "force-dynamic";

export default async function OfferSignPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const slackState =
    typeof resolvedSearchParams.slack === "string" ? resolvedSearchParams.slack : null;
  const offer = await prisma.offer.findUnique({
    where: { token },
    include: {
      application: {
        include: {
          onboardingEvents: true,
          role: true,
        },
      },
    },
  });

  if (!offer) {
    notFound();
  }

  const hasSlackConnectReady = offer.application.onboardingEvents.some(
    (event) => event.type === OnboardingEventType.SLACK_CONNECT_READY,
  );
  const canContinueToSlack = canUseSlackCandidateConnect() && hasSlackConnectReady;
  const slackConnectUrl = canContinueToSlack
    ? getSlackCandidateConnectStartPath(offer.token)
    : null;

  return (
    <div className="mx-auto max-w-4xl">
      <SectionCard
        eyebrow="Offer signing"
        title={`${offer.application.fullName} · ${offer.jobTitle}`}
        description="Review the offer letter, sign in-app, and continue into Slack onboarding when the offer is complete."
      >
        <div className="grid gap-6">
          {slackState === "connected" ? (
            <div className="rounded-[24px] bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
              Slack onboarding is complete. Your welcome message has been sent.
            </div>
          ) : slackState === "failed" ? (
            <div className="rounded-[24px] bg-amber-50 px-5 py-4 text-sm text-amber-800">
              Slack onboarding could not be completed yet. Please try the Slack step again from this page.
            </div>
          ) : null}
          <div
            className="surface-panel p-6"
            dangerouslySetInnerHTML={{ __html: offer.generatedHtml }}
          />
          {offer.status === "SIGNED" ? (
            <div className="grid gap-4 rounded-[24px] bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
              <p>
                This offer was already signed.
                {offer.application.status === "ONBOARDED"
                  ? " Slack onboarding is complete."
                  : " Slack onboarding is the next step."}
              </p>
              {slackConnectUrl ? (
                <div>
                  <Link className="button-primary inline-flex px-4 py-2" href={slackConnectUrl}>
                    Continue to Slack onboarding
                  </Link>
                </div>
              ) : null}
            </div>
          ) : offer.status === "SENT" ? (
            <OfferSignForm offerId={offer.id} />
          ) : (
            <div className="rounded-[24px] bg-amber-50 px-5 py-4 text-sm text-amber-800">
              This offer is still a draft and cannot be signed until it is marked as sent.
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
