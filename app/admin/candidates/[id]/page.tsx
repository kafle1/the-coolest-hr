import Link from "next/link";
import { notFound } from "next/navigation";
import { ActorType, ApplicationStatus } from "@prisma/client";

import { FeedbackForm } from "@/components/feedback-form";
import { LiveRefresh } from "@/components/live-refresh";
import { OfferGenerationForm } from "@/components/offer-generation-form";
import { OverrideForm } from "@/components/override-form";
import { RescheduleDecisionPanel } from "@/components/reschedule-decision-panel";
import { SendInterviewOptionsButton } from "@/components/send-interview-options-button";
import { StatusBadge } from "@/components/status-badge";
import { TranscriptWebhookForm } from "@/components/transcript-webhook-form";
import {
  canGenerateOfferStatus,
  canSendInterviewOptionsStatus,
  getCandidateDetail,
} from "@/lib/applications/service";
import { listManualOverrideTargets } from "@/lib/status/transitions";
import {
  formatDateTime,
  formatFileSize,
  formatStatusLabel,
} from "@/lib/utils/format";

export const dynamic = "force-dynamic";

type CandidateDetail = Awaited<ReturnType<typeof getCandidateDetail>>;

type ActivityItem = {
  id: string;
  category: string;
  title: string;
  detail: string;
  timestamp: Date;
  tone: "default" | "accent" | "success";
};

type StageItem = {
  label: string;
  complete: boolean;
  detail: string;
};

function DetailSection({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t divider pt-8 first:border-t-0 first:pt-0">
      <div className="mb-6">
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function getLatestActivityNote(application: CandidateDetail, actorLabels: string[]) {
  return (
    application.statusHistory.find((item) => actorLabels.includes(item.actorLabel))?.note ?? null
  );
}

function getLatestAutomationNote(application: CandidateDetail) {
  return application.statusHistory.find((item) => item.actorLabel === "Automation")?.note ?? null;
}

function isAutomationRunning(application: CandidateDetail) {
  const latestAutomationNote = getLatestAutomationNote(application);

  if (!latestAutomationNote) {
    return !application.screeningResult;
  }

  return ![
    "Application automation completed after screening.",
    "Application automation completed.",
    "Application automation stopped during screening.",
  ].includes(latestAutomationNote);
}

function getStatusActivityTitle(item: CandidateDetail["statusHistory"][number]) {
  if (item.fromStatus && item.fromStatus !== item.toStatus) {
    return `Moved to ${formatStatusLabel(item.toStatus)}`;
  }

  if (item.actorLabel === "Automation" || item.actorLabel === "AI screening") {
    return item.actorLabel;
  }

  if (item.actorLabel === "Candidate research" || item.actorLabel === "Scheduling automation") {
    return item.actorLabel;
  }

  if (item.actorLabel === "Confirmation email" || item.actorLabel === "Scheduling email") {
    return item.actorLabel;
  }

  if (item.actorType === ActorType.CANDIDATE && item.toStatus === ApplicationStatus.APPLIED) {
    return "Application submitted";
  }

  return formatStatusLabel(item.toStatus);
}

function buildActivityFeed(application: CandidateDetail) {
  const statusItems: ActivityItem[] = application.statusHistory.map((item) => ({
    id: `status-${item.id}`,
    category: item.actorLabel,
    title: getStatusActivityTitle(item),
    detail: item.note ?? "No additional detail was recorded.",
    timestamp: item.createdAt,
    tone:
      item.actorLabel === "Automation" || item.actorLabel === "AI screening"
        ? "accent"
        : "default",
  }));

  const onboardingItems: ActivityItem[] = application.onboardingEvents.map((item) => ({
    id: `onboarding-${item.id}`,
    category: "Onboarding",
    title: formatStatusLabel(item.type),
    detail: item.externalId
      ? `External ID: ${item.externalId}`
      : "Onboarding activity was recorded.",
    timestamp: item.createdAt,
    tone: "success",
  }));

  const emailItems: ActivityItem[] = application.emailLogs.map((item) => ({
    id: `email-${item.id}`,
    category: "Email",
    title: item.subject,
    detail: `${item.deliveryStatus} · ${item.toEmail}`,
    timestamp: item.createdAt,
    tone: "default",
  }));

  return [...statusItems, ...onboardingItems, ...emailItems].sort(
    (left, right) => right.timestamp.getTime() - left.timestamp.getTime(),
  );
}

function buildPipelineStages(application: CandidateDetail): StageItem[] {
  const statusesAfterResearch = new Set<ApplicationStatus>([
    ApplicationStatus.SHORTLISTED,
    ApplicationStatus.INTERVIEW_PENDING,
    ApplicationStatus.INTERVIEW_SCHEDULED,
    ApplicationStatus.INTERVIEW_COMPLETED,
    ApplicationStatus.OFFER_DRAFT,
    ApplicationStatus.OFFER_SENT,
    ApplicationStatus.OFFER_SIGNED,
    ApplicationStatus.SLACK_INVITED,
    ApplicationStatus.ONBOARDED,
  ]);
  const statusesAfterOffer = new Set<ApplicationStatus>([
    ApplicationStatus.OFFER_DRAFT,
    ApplicationStatus.OFFER_SENT,
    ApplicationStatus.OFFER_SIGNED,
    ApplicationStatus.SLACK_INVITED,
    ApplicationStatus.ONBOARDED,
  ]);
  const schedulingStarted =
    Boolean(application.interview) || Boolean(application.interviewPlan?.holds.length);
  const onboardingStarted = application.onboardingEvents.some(
    (event) => event.type === "SLACK_INVITE_SENT",
  );
  const screeningActivity = getLatestActivityNote(application, ["AI screening"]);
  const researchActivity = getLatestActivityNote(application, ["Candidate research"]);
  const schedulingActivity = getLatestActivityNote(application, [
    "Scheduling automation",
    "Scheduling",
  ]);

  return [
    {
      label: "Applied",
      complete: true,
      detail: "Submission, resume upload, and confirmation email",
    },
    {
      label: "Screening",
      complete: Boolean(application.screeningResult),
      detail: application.screeningResult
        ? `Scored at ${application.aiScore ?? application.screeningResult.score}/100`
        : screeningActivity ?? "Screening has not started yet.",
    },
    {
      label: "Research",
      complete: Boolean(application.researchProfile),
      detail: statusesAfterResearch.has(application.status)
        ? application.researchProfile
          ? "Candidate brief and public evidence are attached"
          : researchActivity ?? "Research is queued after shortlisting."
        : "Research starts only for shortlisted candidates",
    },
    {
      label: "Scheduling",
      complete: schedulingStarted,
      detail: schedulingStarted
        ? application.interview
          ? "Interview has been scheduled"
          : "Slot options are available to the candidate"
        : schedulingActivity ?? "Scheduling will start after shortlisting.",
    },
    {
      label: "Interview",
      complete: Boolean(application.interview?.transcript),
      detail: application.interview?.transcript
        ? "Transcript and summary have been stored"
        : application.interview
          ? "Waiting for transcript or interview completion"
          : "Interview has not started yet",
    },
    {
      label: "Offer",
      complete: statusesAfterOffer.has(application.status),
      detail: application.offer
        ? `${formatStatusLabel(application.offer.status)} offer is on file`
        : "Offer workflow has not started",
    },
    {
      label: "Onboarding",
      complete: application.status === ApplicationStatus.ONBOARDED,
      detail: application.status === ApplicationStatus.ONBOARDED
        ? "Slack join and onboarding welcome were completed"
        : onboardingStarted
          ? "Slack invite has been sent"
          : "Onboarding starts after the offer is signed",
    },
  ];
}

function SimpleList({
  items,
  emptyLabel,
}: {
  items: string[];
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-[var(--muted)]">{emptyLabel}</p>;
  }

  return (
    <ul className="border-t divider text-sm">
      {items.map((item) => (
        <li key={item} className="border-b divider py-3 leading-6 last:border-b-0">
          {item}
        </li>
      ))}
    </ul>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b divider py-3 last:border-b-0">
      <dt className="text-sm text-[var(--muted)]">{label}</dt>
      <dd className="text-right text-sm font-medium">{value}</dd>
    </div>
  );
}

export default async function CandidateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const application = await getCandidateDetail(id).catch(() => null);

  if (!application) {
    notFound();
  }

  const activeScheduleLink = application.interviewPlan?.holds.find(
    (hold) => hold.status === "HELD",
  );
  const overrideTargets = listManualOverrideTargets(application.status);
  const canSendInterviewOptions = canSendInterviewOptionsStatus(application.status);
  const canGenerateOffer = canGenerateOfferStatus(application.status);
  const pipelineStages = buildPipelineStages(application);
  const activityFeed = buildActivityFeed(application);
  const automationRunning = isAutomationRunning(application);
  const screeningActivity = getLatestActivityNote(application, ["AI screening"]);
  const researchActivity = getLatestActivityNote(application, ["Candidate research"]);
  const activeStageIndex = automationRunning
    ? pipelineStages.findIndex((stage) => !stage.complete)
    : -1;

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
      <main className="card rounded-[34px] p-6 sm:p-8">
        <header className="border-b divider pb-8">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
            <div>
              <p className="eyebrow">Candidate detail</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[2.5rem]">
                {application.fullName}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--muted)]">
                Applied for {application.role.title} on {formatDateTime(application.submittedAt)}.
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <StatusBadge value={application.status} />
                {application.aiScore != null ? (
                  <span className="rounded-full bg-[var(--surface-muted)] px-3 py-1 text-sm font-semibold">
                    AI score: {application.aiScore}
                  </span>
                ) : null}
                <LiveRefresh enabled={automationRunning} intervalMs={2000} mode="inline" />
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <a
                  className="button-secondary px-4 py-2"
                  href={application.linkedinUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open LinkedIn
                </a>
                {application.portfolioUrl ? (
                  <a
                    className="button-secondary px-4 py-2"
                    href={application.portfolioUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open portfolio
                  </a>
                ) : null}
                {application.resumeAsset ? (
                  <a
                    className="button-secondary px-4 py-2"
                    download
                    href={`/api/admin/applications/${application.id}/resume?download=1`}
                  >
                    Download resume
                  </a>
                ) : null}
              </div>
            </div>

            <dl className="rounded-[28px] bg-[var(--surface-muted)] px-5 py-4">
              <InfoRow label="Current stage" value={formatStatusLabel(application.status)} />
              <InfoRow label="Email" value={application.email} />
              <InfoRow
                label="Resume"
                value={
                  application.resumeAsset
                    ? formatFileSize(application.resumeAsset.sizeBytes)
                    : "No file"
                }
              />
              <InfoRow label="Submitted" value={formatDateTime(application.submittedAt)} />
            </dl>
          </div>
        </header>

        <div className="mt-8 grid gap-8">
          <DetailSection
            eyebrow="Pipeline overview"
            title="Live stage progress"
            description={
              automationRunning
                ? "The next incomplete step pulses while automation is still moving, and this page keeps syncing until the pipeline settles."
                : "Each stage below reflects the latest recorded state for this candidate."
            }
          >
            <ol className="grid gap-4">
              {pipelineStages.map((stage, index) => {
                const isRunning = index === activeStageIndex;

                return (
                  <li
                    key={stage.label}
                    className="grid gap-3 border-b divider pb-4 last:border-b-0 last:pb-0 md:grid-cols-[auto_180px_minmax(0,1fr)_auto] md:items-start"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-muted)]">
                      {stage.complete ? (
                        <span className="text-sm font-semibold text-emerald-700">✓</span>
                      ) : isRunning ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-[rgba(37,99,235,0.22)] border-t-[var(--accent)]" />
                      ) : (
                        <span className="text-xs font-semibold text-[var(--muted)]">
                          {index + 1}
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{stage.label}</p>
                    </div>
                    <p className="text-sm leading-6 text-[var(--muted)]">{stage.detail}</p>
                    <div className="md:text-right">
                      <span
                        className={
                          stage.complete
                            ? "rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
                            : isRunning
                              ? "rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent)]"
                              : "rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600"
                        }
                      >
                        {stage.complete ? "Complete" : isRunning ? "Running" : "Waiting"}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </DetailSection>

          <DetailSection
            eyebrow="Submission"
            title="Resume and source material"
            description="The original file, extracted text, and supporting evidence live together so the operator can review one source of truth."
          >
            {application.resumeAsset ? (
              <div className="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
                <div className="grid gap-4">
                  <dl>
                    <InfoRow label="File" value={application.resumeAsset.originalName} />
                    <InfoRow label="Type" value={application.resumeAsset.mimeType} />
                    <InfoRow
                      label="Size"
                      value={formatFileSize(application.resumeAsset.sizeBytes)}
                    />
                    <InfoRow
                      label="Uploaded"
                      value={formatDateTime(application.resumeAsset.createdAt)}
                    />
                  </dl>
                  <div className="flex flex-wrap gap-3">
                    <a
                      className="button-secondary px-4 py-2"
                      href={`/api/admin/applications/${application.id}/resume`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open resume
                    </a>
                    <a
                      className="button-secondary px-4 py-2"
                      download
                      href={`/api/admin/applications/${application.id}/resume?download=1`}
                    >
                      Download resume
                    </a>
                  </div>
                </div>

                <div className="rounded-[28px] bg-[var(--surface-muted)] p-5">
                  <p className="font-semibold">Extracted text preview</p>
                  <div className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap text-sm leading-7 text-[var(--muted)]">
                    {application.resumeAsset.extractedText ?? "Resume text extraction is still pending."}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">No resume is attached to this application.</p>
            )}
          </DetailSection>

          <DetailSection
            eyebrow="Assessment"
            title="Screening and research"
            description="Screening explains the fit score, and research adds public evidence once the candidate clears the first gate."
          >
            <div className="grid gap-10 xl:grid-cols-[1.12fr_0.88fr]">
              <div className="grid gap-8">
                <div>
                  <p className="eyebrow">Screening</p>
                  <h3 className="mt-3 text-lg font-semibold">AI screening output</h3>
                  {application.screeningResult ? (
                    <div className="mt-4 grid gap-6">
                      <p className="text-sm leading-7 text-[var(--muted)]">
                        {application.screeningResult.summary}
                      </p>

                      <div className="grid gap-8 lg:grid-cols-2">
                        <div>
                          <h4 className="text-sm font-semibold">Strengths</h4>
                          <div className="mt-3">
                            <SimpleList
                              emptyLabel="No strengths were extracted."
                              items={application.screeningResult.strengths}
                            />
                          </div>
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold">Gaps</h4>
                          <div className="mt-3">
                            <SimpleList
                              emptyLabel="No gaps were extracted."
                              items={application.screeningResult.gaps}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_280px]">
                        <div>
                          <h4 className="text-sm font-semibold">Parsed skills</h4>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {application.screeningResult.parsedSkills.map((skill) => (
                              <span
                                key={skill}
                                className="rounded-full bg-[var(--surface-muted)] px-3 py-1 text-xs font-semibold"
                              >
                                {skill}
                              </span>
                            ))}
                          </div>
                        </div>

                        <dl>
                          <InfoRow
                            label="Experience"
                            value={
                              application.screeningResult.yearsExperience != null
                                ? `${application.screeningResult.yearsExperience} years`
                                : "Not parsed"
                            }
                          />
                          <InfoRow
                            label="Education"
                            value={
                              (
                                application.screeningResult.education as
                                  | { highestDegree?: string; focus?: string }
                                  | null
                              )?.highestDegree
                                ? `${(application.screeningResult.education as { highestDegree: string; focus?: string }).highestDegree} — ${(application.screeningResult.education as { focus?: string }).focus ?? "Focus not parsed"}`
                                : "Not parsed"
                            }
                          />
                        </dl>
                      </div>

                      {application.screeningResult.pastEmployers.length > 0 ? (
                        <div>
                          <h4 className="text-sm font-semibold">Past employers</h4>
                          <div className="mt-3">
                            <SimpleList
                              emptyLabel="No employers were extracted."
                              items={application.screeningResult.pastEmployers}
                            />
                          </div>
                        </div>
                      ) : null}

                      {application.screeningResult.achievements.length > 0 ? (
                        <div>
                          <h4 className="text-sm font-semibold">Achievements</h4>
                          <div className="mt-3">
                            <SimpleList
                              emptyLabel="No achievements were extracted."
                              items={application.screeningResult.achievements}
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-[var(--muted)]">
                      {screeningActivity ?? "Screening has not started yet."}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid gap-8 border-t divider pt-8 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
                <div>
                  <p className="eyebrow">Research</p>
                  <h3 className="mt-3 text-lg font-semibold">Candidate intelligence brief</h3>
                  {application.researchProfile ? (
                    <div className="mt-4 grid gap-6">
                      <p className="text-sm leading-7 text-[var(--muted)]">
                        {application.researchProfile.brief}
                      </p>

                      <SimpleList
                        emptyLabel="No public summaries were stored."
                        items={[
                          application.researchProfile.linkedinSummary,
                          application.researchProfile.xSummary,
                          application.researchProfile.githubSummary,
                          application.researchProfile.portfolioSummary,
                        ].filter((item): item is string => Boolean(item))}
                      />

                      <div>
                        <h4 className="text-sm font-semibold">Sources</h4>
                        <ul className="mt-3 border-t divider text-sm">
                          {((application.researchProfile.sources as Array<{
                            label: string;
                            url: string;
                          }>) ?? []).map((source) => (
                            <li
                              key={source.url}
                              className="border-b divider py-3 last:border-b-0"
                            >
                              <a href={source.url} rel="noreferrer" target="_blank">
                                {source.label}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {application.researchProfile.discrepancies.length ? (
                        <div>
                          <h4 className="text-sm font-semibold">Discrepancies</h4>
                          <div className="mt-3">
                            <SimpleList
                              emptyLabel="No discrepancies were found."
                              items={application.researchProfile.discrepancies}
                            />
                          </div>
                        </div>
                      ) : null}

                      {application.researchProfile.limitations.length ? (
                        <div>
                          <h4 className="text-sm font-semibold">Research limitations</h4>
                          <div className="mt-3">
                            <SimpleList
                              emptyLabel="No research limitations were recorded."
                              items={application.researchProfile.limitations}
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-[var(--muted)]">
                      {researchActivity ?? "Research runs only for shortlisted candidates."}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </DetailSection>

          <DetailSection
            eyebrow="Interview ops"
            title="Scheduling, transcript, and feedback"
            description="Scheduling, reschedules, transcript ingestion, and interview feedback stay together so the operator can work from one flow."
          >
            <div className="grid gap-10 xl:grid-cols-[1.08fr_0.92fr]">
              <div className="grid gap-8">
                <div>
                  <p className="eyebrow">Scheduling</p>
                  <h3 className="mt-3 text-lg font-semibold">Interview operations</h3>
                  <div className="mt-4 grid gap-5">
                    <div className="flex flex-wrap items-center gap-3">
                      {canSendInterviewOptions ? (
                        <SendInterviewOptionsButton applicationId={application.id} />
                      ) : (
                        <p className="text-sm text-[var(--muted)]">
                          Scheduling actions become available after the candidate is shortlisted.
                        </p>
                      )}

                      {activeScheduleLink ? (
                        <Link
                          className="button-secondary px-4 py-2"
                          href={`/candidates/schedule/${activeScheduleLink.token}`}
                        >
                          Open candidate scheduling link
                        </Link>
                      ) : null}
                    </div>

                    {application.interviewPlan?.holds.length ? (
                      <div>
                        <h4 className="text-sm font-semibold">Slot holds</h4>
                        <div className="mt-3 border-t divider text-sm">
                          {application.interviewPlan.holds.map((hold) => (
                            <div
                              key={hold.id}
                              className="grid gap-2 border-b divider py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto]"
                            >
                              <div>
                                <p className="font-medium">{formatDateTime(hold.startsAt)}</p>
                                <p className="mt-1 text-[var(--muted)]">
                                  Ends {formatDateTime(hold.endsAt)}
                                </p>
                              </div>
                              <p className="text-sm font-semibold text-[var(--muted)]">
                                {hold.status}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {application.interviewPlan ? (
                      <dl>
                        <InfoRow
                          label="Last options sent"
                          value={
                            application.interviewPlan.lastOptionsSentAt
                              ? formatDateTime(application.interviewPlan.lastOptionsSentAt)
                              : "Not sent yet"
                          }
                        />
                        <InfoRow
                          label="Last nudge"
                          value={
                            application.interviewPlan.lastNudgeAt
                              ? formatDateTime(application.interviewPlan.lastNudgeAt)
                              : "No follow-up sent yet"
                          }
                        />
                      </dl>
                    ) : null}

                    {application.interviewPlan?.candidateRequestNote ? (
                      <RescheduleDecisionPanel
                        applicationId={application.id}
                        requestNote={application.interviewPlan.candidateRequestNote}
                      />
                    ) : null}

                    {application.interview ? (
                      <div className="rounded-[24px] bg-[var(--surface-muted)] p-5 text-sm">
                        <p className="font-semibold">Confirmed interview</p>
                        <p className="mt-3 text-[var(--muted)]">
                          {formatDateTime(application.interview.startsAt)}
                        </p>
                        <p className="mt-1 text-[var(--muted)]">
                          Calendar response: {application.interview.attendeeResponseStatus}
                        </p>
                        {application.interview.meetingUrl ? (
                          <a
                            className="mt-3 inline-flex font-semibold text-[var(--accent)]"
                            href={application.interview.meetingUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Open meeting link
                          </a>
                        ) : null}
                      </div>
                    ) : null}

                    <div>
                      <h4 className="text-sm font-semibold">Transcript</h4>
                      {application.interview ? (
                        <div className="mt-3 grid gap-4">
                          <TranscriptWebhookForm
                            applicationId={application.id}
                            className="gap-4"
                          />
                          {application.interview?.transcript ? (
                            <div className="rounded-[24px] bg-[var(--surface-muted)] p-5 text-sm">
                              <p className="font-semibold">Transcript summary</p>
                              <p className="mt-3 leading-7 text-[var(--muted)]">
                                {application.interview.transcript.summary}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm text-[var(--muted)]">
                          Transcript ingestion is available once an interview is scheduled.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-8 border-t divider pt-8 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
                <div>
                  <p className="eyebrow">Feedback</p>
                  <h3 className="mt-3 text-lg font-semibold">Evidence-aware interview feedback</h3>
                  <div className="mt-4 grid gap-5">
                    <FeedbackForm applicationId={application.id} className="gap-4" />

                    {application.interview?.feedback.length ? (
                      <div className="border-t divider text-sm">
                        {application.interview.feedback.map((item) => (
                          <div
                            key={item.id}
                            className="border-b divider py-4 last:border-b-0"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="font-semibold">{item.authorName}</p>
                              {item.requiresAttention ? (
                                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                                  Needs attention
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-3 leading-6 text-[var(--muted)]">
                              {item.content}
                            </p>
                            {item.flaggedPhrases.length ? (
                              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
                                Flagged: {item.flaggedPhrases.join(", ")}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-[var(--muted)]">
                        No interview feedback has been stored yet.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </DetailSection>

          <DetailSection
            eyebrow="Offer"
            title="Offer generation and onboarding"
            description="Offer drafting, signing state, and onboarding signals are grouped so the final stages read as one handoff."
          >
            <div className="grid gap-10 xl:grid-cols-[1.05fr_0.95fr]">
              <div className="grid gap-6">
                <div>
                  <p className="eyebrow">Offer</p>
                  <h3 className="mt-3 text-lg font-semibold">Offer generation and signing</h3>
                  <div className="mt-4 grid gap-5">
                    {canGenerateOffer ? (
                      <OfferGenerationForm
                        applicationId={application.id}
                        className="gap-4"
                        roleTitle={application.role.title}
                      />
                    ) : (
                      <p className="text-sm text-[var(--muted)]">
                        Offer generation becomes available after the interview is completed.
                      </p>
                    )}

                    {application.offer ? (
                      <div className="rounded-[24px] bg-[var(--surface-muted)] p-5 text-sm">
                        <p className="font-semibold">Current offer</p>
                        <p className="mt-2 text-[var(--muted)]">
                          {application.offer.jobTitle} · {application.offer.status}
                        </p>
                        <dl className="mt-4">
                          <InfoRow
                            label="Sent"
                            value={
                              application.offer.sentAt
                                ? formatDateTime(application.offer.sentAt)
                                : "Not sent"
                            }
                          />
                          <InfoRow
                            label="Signed by"
                            value={application.offer.signerName ?? "Pending signature"}
                          />
                          <InfoRow
                            label="Signed at"
                            value={
                              application.offer.signedAt
                                ? formatDateTime(application.offer.signedAt)
                                : "Pending signature"
                            }
                          />
                          <InfoRow
                            label="Alert sent"
                            value={
                              application.offer.alertSentAt
                                ? formatDateTime(application.offer.alertSentAt)
                                : "Not yet"
                            }
                          />
                        </dl>
                        <div className="mt-4 flex flex-wrap gap-3">
                          <Link
                            className="button-secondary px-4 py-2"
                            href={`/offers/sign/${application.offer.token}`}
                          >
                            Open sign page
                          </Link>
                          <a
                            className="button-secondary px-4 py-2"
                            href={`data:text/html;charset=utf-8,${encodeURIComponent(application.offer.generatedHtml)}`}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Open HTML preview
                          </a>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="grid gap-8 border-t divider pt-8 xl:border-l xl:border-t-0 xl:pl-8 xl:pt-0">
                <div>
                  <p className="eyebrow">Onboarding</p>
                  <h3 className="mt-3 text-lg font-semibold">Slack and onboarding state</h3>
                  {application.onboardingEvents.length ? (
                    <div className="mt-4 border-t divider text-sm">
                      {application.onboardingEvents.map((item) => (
                        <div
                          key={item.id}
                          className="border-b divider py-4 last:border-b-0"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-semibold">{formatStatusLabel(item.type)}</p>
                            <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                              {formatDateTime(item.createdAt)}
                            </p>
                          </div>
                          {item.externalId ? (
                            <p className="mt-2 text-[var(--muted)]">
                              External ID: {item.externalId}
                            </p>
                          ) : (
                            <p className="mt-2 text-[var(--muted)]">
                              Event captured successfully.
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-[var(--muted)]">
                      Onboarding starts after the offer is signed.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </DetailSection>
        </div>
      </main>

      <aside className="grid gap-6 self-start xl:sticky xl:top-24">
        <div className="surface-panel p-6">
          <p className="eyebrow">Operator actions</p>
          <h2 className="mt-3 text-xl font-semibold tracking-tight">Candidate profile</h2>
          <dl className="mt-4">
            <InfoRow label="Email" value={application.email} />
            <InfoRow
              label="LinkedIn"
              value={
                <a href={application.linkedinUrl} rel="noreferrer" target="_blank">
                  Open profile
                </a>
              }
            />
            {application.portfolioUrl ? (
              <InfoRow
                label="Portfolio"
                value={
                  <a href={application.portfolioUrl} rel="noreferrer" target="_blank">
                    Open link
                  </a>
                }
              />
            ) : null}
            <InfoRow label="Current stage" value={formatStatusLabel(application.status)} />
          </dl>

          <div className="mt-6 border-t divider pt-5">
            <OverrideForm
              applicationId={application.id}
              className="gap-4"
              currentStatus={application.status}
              targets={overrideTargets}
            />
          </div>
        </div>

        <div className="surface-panel p-6">
          <p className="eyebrow">Live activity</p>
          <h2 className="mt-3 text-xl font-semibold tracking-tight">
            Pipeline events, emails, and onboarding updates
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {automationRunning
              ? "The timeline updates while intake is still moving."
              : "Every recorded pipeline event appears here in reverse chronological order."}
          </p>

          <div className="mt-6 max-h-[68vh] overflow-auto pr-2">
            <ol className="border-l divider pl-5">
              {activityFeed.map((item) => (
                <li key={item.id} className="relative pb-6 last:pb-0">
                  <span
                    className={
                      item.tone === "accent"
                        ? "absolute -left-[1.48rem] top-1.5 h-3 w-3 rounded-full bg-[var(--accent)]"
                        : item.tone === "success"
                          ? "absolute -left-[1.48rem] top-1.5 h-3 w-3 rounded-full bg-emerald-500"
                          : "absolute -left-[1.48rem] top-1.5 h-3 w-3 rounded-full bg-slate-300"
                    }
                  />
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="eyebrow">{item.category}</p>
                      <p className="mt-2 text-sm font-semibold">{item.title}</p>
                    </div>
                    <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">
                      {formatDateTime(item.timestamp)}
                    </p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{item.detail}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </aside>
    </div>
  );
}
