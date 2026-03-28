import { notFound } from "next/navigation";

import { OfferSignForm } from "@/components/offer-sign-form";
import { SectionCard } from "@/components/section-card";
import { prisma } from "@/lib/prisma/client";

export const dynamic = "force-dynamic";

export default async function OfferSignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const offer = await prisma.offer.findUnique({
    where: { token },
    include: {
      application: {
        include: {
          role: true,
        },
      },
    },
  });

  if (!offer) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-4xl">
      <SectionCard
        eyebrow="Offer signing"
        title={`${offer.application.fullName} · ${offer.jobTitle}`}
        description="Review the offer letter, sign in-app, and trigger Slack onboarding on completion."
      >
        <div className="grid gap-6">
          <div
            className="surface-panel p-6"
            dangerouslySetInnerHTML={{ __html: offer.generatedHtml }}
          />
          {offer.status === "SIGNED" ? (
            <div className="rounded-[24px] bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
              This offer was already signed. Slack onboarding should already be in motion.
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
