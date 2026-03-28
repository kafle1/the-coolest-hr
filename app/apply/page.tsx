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
  const hasOpenRoles = roles.length > 0;

  return (
    <div className="grid gap-8 lg:grid-cols-[0.92fr_1.08fr]">
      <SectionCard
        eyebrow="Application"
        title="Share your background through one clear submission"
        description="Choose the role that fits best, add your core links, and upload your resume. The system handles confirmation, screening, and follow-up automatically."
      >
        <div className="grid gap-4">
          {[
            "Upload a PDF or DOCX resume up to 5 MB.",
            "Submit one application per role with the email you want to use for future updates.",
            "After submission, you will receive a confirmation email and can check progress from the tracker anytime.",
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
        title={hasOpenRoles ? "Submit your details" : "Applications are currently closed"}
        description={
          hasOpenRoles
            ? "Complete the required fields carefully so the team has the right context from the start."
            : "There are no open roles available to apply to right now."
        }
      >
        {hasOpenRoles ? (
          <ApplicationForm
            roles={roles.map((role) => ({
              id: role.id,
              title: role.title,
            }))}
            initialRoleId={params.role}
          />
        ) : (
          <div className="surface-panel px-5 py-8">
            <p className="text-sm leading-6 text-[var(--muted)]">
              Open positions appear here automatically as soon as they are published. If you already submitted an application, you can still check progress from the tracker.
            </p>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
