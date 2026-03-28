import { ApplicationForm } from "@/components/application-form";
import { SectionCard } from "@/components/section-card";
import { getOpenRoles } from "@/lib/applications/service";

export const dynamic = "force-dynamic";

export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const params = await searchParams;
  const roles = await getOpenRoles();

  return (
    <div className="grid gap-8 lg:grid-cols-[0.92fr_1.08fr]">
      <SectionCard
        eyebrow="Apply"
        title="Share your background in one clear application"
        description="Fill out your details, upload your resume, and submit your application for the role that fits you best."
      >
        <div className="grid gap-4">
          {[
            "Resumes are accepted in PDF or DOCX format, up to 5 MB.",
            "You can use this form for any currently open role listed on the careers page.",
            "After you apply, you will receive a confirmation email and can return later to check your status.",
          ].map((item, index) => (
            <div key={item} className="surface-panel flex items-start gap-3 px-4 py-4 text-sm leading-7 text-[var(--muted)]">
              <span className="mt-1 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent)]">
                {index + 1}
              </span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="Application form"
        title="Submit your details"
        description="Please complete the required fields carefully so the team has the right context for your application."
      >
        <ApplicationForm
          roles={roles.map((role) => ({
            id: role.id,
            title: role.title,
          }))}
          initialRoleId={params.role}
        />
      </SectionCard>
    </div>
  );
}
