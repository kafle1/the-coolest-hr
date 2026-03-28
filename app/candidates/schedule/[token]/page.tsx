import { notFound } from "next/navigation";

import { ScheduleSlotActions } from "@/components/schedule-slot-actions";
import { SectionCard } from "@/components/section-card";
import { prisma } from "@/lib/prisma/client";
import { formatDateTime } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function ScheduleTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const hold = await prisma.interviewSlotHold.findUnique({
    where: { token },
    include: {
      interviewPlan: {
        include: {
          application: {
            include: {
              role: true,
              interview: true,
            },
          },
        },
      },
    },
  });

  if (!hold) {
    notFound();
  }

  const interview = hold.interviewPlan.application.interview;
  const canConfirm = hold.status === "HELD" && hold.expiresAt > new Date();
  const isConfirmed = hold.status === "CONFIRMED" || Boolean(interview);

  return (
    <div className="mx-auto max-w-3xl">
      <SectionCard
        eyebrow="Candidate scheduling"
        title={`Interview for ${hold.interviewPlan.application.role.title}`}
        description={`Requested by ${hold.interviewPlan.application.fullName}`}
      >
        <div className="grid gap-5 text-sm">
          <div className="surface-panel p-5">
            <p className="eyebrow">{isConfirmed ? "Confirmed slot" : "Proposed slot"}</p>
            <p className="mt-2 text-2xl font-semibold">{formatDateTime(hold.startsAt)}</p>
            <p className="mt-2 text-[var(--muted)]">
              {isConfirmed
                ? "Your interview is confirmed."
                : `Status: ${hold.status}. This hold expires at ${formatDateTime(hold.expiresAt)}.`}
            </p>
            {interview?.meetingUrl ? (
              <a
                className="mt-4 inline-flex font-semibold text-[var(--accent)]"
                href={interview.meetingUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open meeting link
              </a>
            ) : isConfirmed ? (
              <p className="mt-4 text-sm text-[var(--muted)]">
                Your confirmation email and calendar invite are on the way.
              </p>
            ) : null}
          </div>

          <ScheduleSlotActions token={token} canConfirm={canConfirm} />
        </div>
      </SectionCard>
    </div>
  );
}
