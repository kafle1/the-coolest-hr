import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionCard } from "@/components/section-card";
import { StatusBadge } from "@/components/status-badge";
import { getRoleBySlug } from "@/lib/applications/service";

export const dynamic = "force-dynamic";

export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const role = await getRoleBySlug(slug);

  if (!role) {
    notFound();
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
      <SectionCard
        eyebrow={role.team}
        title={role.title}
        description={role.summary}
      >
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <StatusBadge value={role.status} />
          <span className="text-sm text-[var(--muted)]">
            {role.location} · {role.remoteStatus} · {role.experienceLevel}
          </span>
        </div>
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <div className="metric-card">
            <p className="eyebrow">Team</p>
            <p className="mt-3 text-base font-semibold">{role.team}</p>
          </div>
          <div className="metric-card">
            <p className="eyebrow">Location</p>
            <p className="mt-3 text-base font-semibold">{role.location}</p>
          </div>
          <div className="metric-card">
            <p className="eyebrow">Work style</p>
            <p className="mt-3 text-base font-semibold">{role.remoteStatus}</p>
          </div>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="text-lg font-semibold">Responsibilities</h3>
            <ul className="mt-3 grid gap-3 text-sm leading-7 text-[var(--muted)]">
              {role.responsibilities.map((item) => (
                <li key={item} className="surface-panel px-4 py-3">
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-semibold">Requirements</h3>
            <ul className="mt-3 grid gap-3 text-sm leading-7 text-[var(--muted)]">
              {role.requirements.map((item) => (
                <li key={item} className="surface-panel px-4 py-3">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="Next step"
        title="Ready to apply?"
        description="Submit your details, upload your resume, and the team will review your application for this role."
      >
        <div className="grid gap-3 text-sm leading-7 text-[var(--muted)]">
          <div className="surface-panel px-4 py-4">
            The form asks for your name, email, LinkedIn profile, optional portfolio or GitHub link, and resume.
          </div>
          <div className="surface-panel px-4 py-4">
            Duplicate submissions for the same role and email are blocked automatically.
          </div>
          <div className="surface-panel px-4 py-4">
            After submission, you can return to the application tracker at any time to follow progress.
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={`/apply?role=${role.id}`} className="button-primary">
            Apply for this role
          </Link>
          <Link href="/candidates/status" className="button-secondary">
            Open application tracker
          </Link>
        </div>
      </SectionCard>
    </div>
  );
}
