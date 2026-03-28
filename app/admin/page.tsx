import Link from "next/link";
import { ApplicationStatus } from "@prisma/client";

import { LiveRefresh } from "@/components/live-refresh";
import { LogoutButton } from "@/components/logout-button";
import { SectionCard } from "@/components/section-card";
import { SendSchedulingNudgesButton } from "@/components/send-scheduling-nudges-button";
import { StatusBadge } from "@/components/status-badge";
import { listAdminApplications, listRoles } from "@/lib/applications/service";
import { getGoogleCalendarConnectionState } from "@/lib/calendar/oauth-config";
import { formatDateTime, formatStatusLabel } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

const statuses = Object.values(ApplicationStatus);
const shortlistedOrLaterStatuses: ApplicationStatus[] = [
  ApplicationStatus.SHORTLISTED,
  ApplicationStatus.INTERVIEW_PENDING,
  ApplicationStatus.INTERVIEW_SCHEDULED,
  ApplicationStatus.INTERVIEW_COMPLETED,
  ApplicationStatus.OFFER_DRAFT,
  ApplicationStatus.OFFER_SENT,
  ApplicationStatus.OFFER_SIGNED,
  ApplicationStatus.SLACK_INVITED,
  ApplicationStatus.ONBOARDED,
];
const actionableStatuses: ApplicationStatus[] = [
  ApplicationStatus.INTERVIEW_PENDING,
  ApplicationStatus.INTERVIEW_COMPLETED,
  ApplicationStatus.OFFER_DRAFT,
  ApplicationStatus.OFFER_SENT,
  ApplicationStatus.SLACK_INVITED,
];

function isApplicationAutomationRunning(application: {
  status: ApplicationStatus;
  screeningResult: { id: string } | null;
}) {
  if (!application.screeningResult) {
    return true;
  }

  return application.status === ApplicationStatus.SHORTLISTED;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    roleId?: string;
    status?: ApplicationStatus;
    startDate?: string;
    endDate?: string;
  }>;
}) {
  const params = await searchParams;
  const [applications, roles] = await Promise.all([
    listAdminApplications(params),
    listRoles(),
  ]);
  const automationRunning = applications.some(isApplicationAutomationRunning);
  const calendarConnection = getGoogleCalendarConnectionState();
  const metrics = [
    {
      label: "Applications",
      value: applications.length,
      note: "All candidates in the current filter set",
    },
    {
      label: "Intake running",
      value: applications.filter((application) => !application.screeningResult).length,
      note: "Applications that are still moving through screening",
    },
    {
      label: "Shortlisted or later",
      value: applications.filter((application) =>
        shortlistedOrLaterStatuses.includes(application.status),
      ).length,
      note: "Candidates that cleared the first decision gate",
    },
    {
      label: "Actionable now",
      value: applications.filter((application) =>
        actionableStatuses.includes(application.status),
      ).length,
      note: "Candidates likely to need a follow-up or review",
    },
  ];

  return (
    <div className="grid gap-8">
      <LiveRefresh enabled={automationRunning} intervalMs={5000} />

      <SectionCard
        eyebrow="Admin dashboard"
        title="One operating view for the hiring pipeline"
        description="Review intake, AI screening, research, scheduling, interview evidence, offers, and onboarding from one dashboard built for fast operator decisions."
      >
        <div className="mb-6">
          <div className="surface-panel flex flex-col gap-4 p-5">
            <div>
              <p className="eyebrow">Google Calendar</p>
              <p className="mt-3 text-base font-semibold">
                {calendarConnection.connected
                  ? "Real interview scheduling is connected."
                  : "Real interview scheduling still needs Google user authorization."}
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {calendarConnection.connected
                  ? calendarConnection.connectedEmail
                    ? `Connected as ${calendarConnection.connectedEmail} on ${calendarConnection.calendarId}.`
                    : `Connected calendar: ${calendarConnection.calendarId}.`
                  : calendarConnection.reason === "service-account"
                    ? "The workspace is still on service-account auth, which cannot send candidate invites or create real Google Meet links."
                    : calendarConnection.reason === "missing-oauth-client"
                      ? "Google OAuth client credentials are missing from the environment."
                      : calendarConnection.reason === "missing-calendar-id"
                        ? "Google authorization exists, but no writable calendar has been selected yet."
                        : "Finish the Google approval flow once from this workspace and the connection will persist across database resets."}
              </p>
            </div>
            {!calendarConnection.connected ? (
              <div className="flex flex-wrap gap-3">
                <a className="button-primary" href={calendarConnection.connectUrl}>
                  Connect Google Calendar
                </a>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mb-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map((metric) => (
              <div key={metric.label} className="metric-card">
                <p className="eyebrow">{metric.label}</p>
                <p className="mt-3 text-3xl font-semibold">{metric.value}</p>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{metric.note}</p>
              </div>
            ))}
          </div>
          <div className="surface-panel flex flex-col justify-between gap-4 p-5">
            <div>
              <p className="eyebrow">Automation status</p>
              <p className="mt-3 text-base font-semibold">
                New applications begin processing as soon as they are submitted.
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                Open any candidate to inspect evidence, review exceptions, and step in only when a decision needs a human.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <LiveRefresh enabled={automationRunning} intervalMs={5000} mode="inline" />
              <SendSchedulingNudgesButton />
              <div className="ml-auto">
                <LogoutButton />
              </div>
            </div>
          </div>
        </div>

        <form className="mb-6 grid gap-4 rounded-[24px] border border-[var(--border)] bg-[var(--surface-muted)] p-5 md:grid-cols-5">
          <label className="grid gap-2 text-sm font-semibold">
            Role
            <select className="field" defaultValue={params.roleId ?? ""} name="roleId">
              <option value="">All roles</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.title}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Status
            <select className="field" defaultValue={params.status ?? ""} name="status">
              <option value="">All statuses</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {formatStatusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Start date
            <input className="field" defaultValue={params.startDate} name="startDate" type="date" />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            End date
            <input className="field" defaultValue={params.endDate} name="endDate" type="date" />
          </label>
          <div className="flex items-end gap-3">
            <button className="button-primary" type="submit">
              Apply filters
            </button>
            <Link className="button-secondary" href="/admin">
              Reset
            </Link>
          </div>
        </form>

        <div className="grid gap-3">
          <div className="hidden grid-cols-[1.35fr_1fr_0.95fr_0.65fr] gap-3 px-3 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)] md:grid">
            <span>Candidate</span>
            <span>Pipeline</span>
            <span>Submitted</span>
            <span>Fit score</span>
          </div>
          {applications.length === 0 ? (
            <div className="surface-panel px-5 py-12 text-center text-sm text-[var(--muted)]">
              No applications match the current filters yet.
            </div>
          ) : (
            applications.map((application) => (
              <Link
                key={application.id}
                href={`/admin/candidates/${application.id}`}
                className="surface-panel grid gap-4 p-5 transition hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(15,23,42,0.06)] md:grid-cols-[1.35fr_1fr_0.95fr_0.65fr]"
              >
                <div>
                  <p className="text-base font-semibold">{application.fullName}</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">{application.email}</p>
                  <p className="mt-3 text-sm text-[var(--muted)]">
                    {application.role.title}
                  </p>
                </div>
                <div className="grid content-start gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)] md:hidden">
                    Pipeline
                  </p>
                  <StatusBadge value={application.status} />
                  <p className="text-sm text-[var(--muted)]">
                    {application.screeningResult
                      ? "Screening is complete and evidence is attached."
                      : "Intake automation is still processing this application."}
                  </p>
                </div>
                <div className="text-sm text-[var(--muted)]">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)] md:hidden">
                    Submitted
                  </p>
                  {formatDateTime(application.submittedAt)}
                </div>
                <div className="text-sm font-semibold">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)] md:hidden">
                    Fit score
                  </p>
                  {application.aiScore ?? application.screeningResult?.score ?? "Pending"}
                </div>
              </Link>
            ))
          )}
        </div>
      </SectionCard>
    </div>
  );
}
