import Link from "next/link";

import { SectionCard } from "@/components/section-card";
import { StatusBadge } from "@/components/status-badge";
import { getOpenRoles } from "@/lib/applications/service";

export const dynamic = "force-dynamic";

const phases = [
  "Browse open roles and choose the best fit",
  "Submit your application and resume online",
  "Receive updates as your application is reviewed",
  "Meet the team if you move forward",
  "Review your offer and prepare for onboarding",
];

export default async function Home() {
  const roles = await getOpenRoles();
  const openRoleCount = roles.length;
  const teamCount = new Set(roles.map((role) => role.team)).size;

  return (
    <div className="grid gap-8">
      <SectionCard
        eyebrow="Niural Careers"
        title="Join a team building ambitious products with care"
        description="Explore open roles, learn what each team is working on, and submit your application in a few minutes."
      >
        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="metric-card">
                <p className="eyebrow">Open roles</p>
                <p className="mt-3 text-3xl font-semibold">{openRoleCount}</p>
              </div>
              <div className="metric-card">
                <p className="eyebrow">Teams hiring</p>
                <p className="mt-3 text-3xl font-semibold">{teamCount}</p>
              </div>
              <div className="metric-card">
                <p className="eyebrow">Hiring steps</p>
                <p className="mt-3 text-3xl font-semibold">{phases.length}</p>
              </div>
            </div>
            <p className="mt-6 max-w-3xl text-[15px] leading-7 text-[var(--muted)]">
              We want the application experience to feel clear, respectful, and fast. You can review the role details, apply online, and come back anytime to check where things stand.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/apply" className="button-primary">
                Apply now
              </Link>
              <Link href="/candidates/status" className="button-secondary">
                Check application status
              </Link>
            </div>
          </div>
          <div className="surface-panel p-6">
            <p className="eyebrow">What to expect</p>
            <ul className="mt-4 grid gap-3 text-sm text-[var(--ink)]">
              {phases.map((phase, index) => (
                <li
                  key={phase}
                  className="flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3"
                >
                  <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-semibold text-[var(--muted)]">
                    {index + 1}
                  </span>
                  <span>{phase}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="Open roles"
        title="Current job openings"
        description="Each listing includes the role overview, team, location, experience level, responsibilities, and requirements."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {roles.map((role) => (
            <article key={role.id} className="surface-panel p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="eyebrow">{role.team}</p>
                  <h3 className="mt-2 text-xl font-semibold tracking-tight">{role.title}</h3>
                </div>
                <StatusBadge value={role.status} />
              </div>
              <p className="mt-4 text-sm leading-7 text-[var(--muted)]">{role.summary}</p>
              <dl className="mt-5 grid gap-2 text-sm text-[var(--ink)]">
                <div className="flex justify-between gap-3 border-b divider pb-2">
                  <dt className="text-[var(--muted)]">Location</dt>
                  <dd>{role.location}</dd>
                </div>
                <div className="flex justify-between gap-3 border-b divider pb-2">
                  <dt className="text-[var(--muted)]">Work mode</dt>
                  <dd>{role.remoteStatus}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--muted)]">Level</dt>
                  <dd>{role.experienceLevel}</dd>
                </div>
              </dl>
              <div className="mt-5 flex gap-3">
                <Link href={`/roles/${role.slug}`} className="button-secondary">
                  View role
                </Link>
                <Link href={`/apply?role=${role.id}`} className="button-primary">
                  Apply
                </Link>
              </div>
            </article>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
