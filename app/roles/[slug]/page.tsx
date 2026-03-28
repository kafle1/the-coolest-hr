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
        <div className="mb-6 flex items-center gap-3">
          <StatusBadge value={role.status} />
          <span className="text-sm text-[var(--muted)]">
            {role.location} · {role.remoteStatus} · {role.experienceLevel}
          </span>
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
        description="Submit your details, upload your resume, and we will review your application for this role."
      >
        <div className="grid gap-3 text-sm leading-7 text-[var(--muted)]">
          <div className="surface-panel px-4 py-4">
            The application asks for your name, email, LinkedIn profile, optional portfolio or GitHub link, and resume.
          </div>
          <div className="surface-panel px-4 py-4">
            If you already applied to this same role with the same email address, the form will let you know.
          </div>
          <div className="surface-panel px-4 py-4">
            Once submitted, you can return to the status page at any time to follow your application.
          </div>
        </div>
        <div className="mt-6">
          <Link href={`/apply?role=${role.id}`} className="button-primary">
            Apply for this role
          </Link>
        </div>
      </SectionCard>
    </div>
  );
}
