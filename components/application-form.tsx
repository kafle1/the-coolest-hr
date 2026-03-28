"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

type RoleOption = {
  id: string;
  title: string;
};

export function ApplicationForm({
  roles,
  initialRoleId,
}: {
  roles: RoleOption[];
  initialRoleId?: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const hasRoles = roles.length > 0;
  const initialSelection =
    initialRoleId && roles.some((role) => role.id === initialRoleId) ? initialRoleId : "";

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        setMessage(null);
        setWarning(null);

        const form = event.currentTarget;
        const formData = new FormData(form);
        const resume = formData.get("resume");

        if (!(resume instanceof File) || resume.size === 0) {
          setError("Please upload a resume.");
          return;
        }

        const normalizedName = resume.name.toLowerCase();
        const hasAllowedExtension =
          normalizedName.endsWith(".pdf") || normalizedName.endsWith(".docx");
        const hasAllowedMimeType =
          resume.type === "application/pdf" ||
          resume.type ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

        if (!hasAllowedExtension && !hasAllowedMimeType) {
          setError("Please upload a PDF or DOCX resume.");
          return;
        }

        if (resume.size > 5 * 1024 * 1024) {
          setError("Resume upload must be smaller than 5 MB.");
          return;
        }

        startTransition(async () => {
          try {
            const response = await fetch("/api/applications", {
              method: "POST",
              body: formData,
            });
            const payload = (await response.json()) as {
              ok: boolean;
              message?: string;
              warning?: string;
            };

            if (!response.ok) {
              throw new Error(payload.message ?? "Unable to submit application.");
            }

            form.reset();
            const roleField = form.elements.namedItem("roleId") as HTMLSelectElement | null;

            if (roleField) {
              roleField.value = initialSelection;
            }

            setMessage(
              payload.message ??
                "Application submitted successfully. We will update you by email.",
            );
            setWarning(payload.warning ?? null);
          } catch (submissionError) {
            setError(
              submissionError instanceof Error
                ? submissionError.message
                : "Unable to submit application.",
            );
          }
        });
      }}
    >
      <div className="grid gap-4 rounded-[24px] border border-[var(--border)] bg-[var(--surface-muted)] p-5">
        <div>
          <h3 className="text-base font-semibold">Personal details</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Use the same email address you want to receive updates on throughout the hiring process.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-semibold">
            Full name
            <input className="field" name="fullName" placeholder="Niraj Kafle" required />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Email address
            <input className="field" name="email" placeholder="niraj@example.com" type="email" required />
          </label>
        </div>
      </div>

      <div className="grid gap-4 rounded-[24px] border border-[var(--border)] bg-[var(--surface-muted)] p-5">
        <div>
          <h3 className="text-base font-semibold">Professional links</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Add the profiles most relevant to this role. LinkedIn is required, while portfolio or GitHub is optional.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-semibold">
            LinkedIn URL
            <input className="field" name="linkedinUrl" placeholder="https://linkedin.com/in/..." type="url" required />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Portfolio or GitHub
            <input className="field" name="portfolioUrl" placeholder="https://github.com/..." type="url" />
          </label>
        </div>
      </div>

      <div className="grid gap-4 rounded-[24px] border border-[var(--border)] bg-[var(--surface-muted)] p-5">
        <div>
          <h3 className="text-base font-semibold">Role and resume</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Choose one open role and upload the resume you want reviewed for that position.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-semibold">
            Role
            <select className="field" name="roleId" defaultValue={initialSelection} required disabled={!hasRoles}>
              <option value="" disabled>
                Select a role
              </option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.title}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Resume
            <input className="field" name="resume" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required disabled={!hasRoles} />
          </label>
        </div>
        <p className="text-sm leading-6 text-[var(--muted)]">
          Accepted formats: PDF or DOCX. Files larger than 5 MB are blocked before upload. If you already applied to the same role with this email, the system will stop duplicate submissions.
        </p>
      </div>

      {error ? <p className="rounded-2xl bg-rose-100 px-4 py-3 text-sm text-rose-700" aria-live="polite">{error}</p> : null}
      {warning ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800" aria-live="polite">
          {warning}
        </p>
      ) : null}
      {message ? (
        <div className="rounded-[24px] bg-emerald-50 px-4 py-4 text-sm text-emerald-700" aria-live="polite">
          <p className="font-semibold">{message}</p>
          <p className="mt-1">
            Use the same email address on the{" "}
            <Link href="/candidates/status" className="underline underline-offset-2">
              application tracker
            </Link>{" "}
            whenever you want to check progress.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button className="button-primary w-full sm:w-fit" disabled={isPending || !hasRoles} type="submit">
          {isPending ? "Submitting application..." : "Submit application"}
        </button>
        <p className="text-sm text-[var(--muted)]">
          Average completion time: about 2 minutes.
        </p>
      </div>
    </form>
  );
}
