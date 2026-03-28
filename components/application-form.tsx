"use client";

import { useState, useTransition } from "react";

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
  const defaultRoleId = initialRoleId ?? roles[0]?.id ?? "";

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
              roleField.value = defaultRoleId;
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
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold">
          Full name
          <input className="field" name="fullName" placeholder="Niraj Kafle" required />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Email
          <input className="field" name="email" placeholder="niraj@example.com" type="email" required />
        </label>
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

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold">
          Role
          <select className="field" name="roleId" defaultValue={defaultRoleId} required>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.title}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Resume
          <input className="field" name="resume" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required />
        </label>
      </div>

      <p className="text-sm text-[var(--muted)]">
        PDF and DOCX uploads are accepted. Files over 5 MB are rejected before storage.
      </p>

      {error ? <p className="rounded-2xl bg-rose-100 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      {warning ? (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {warning}
        </p>
      ) : null}
      {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p> : null}

      <button className="button-primary w-full sm:w-fit" disabled={isPending} type="submit">
        {isPending ? "Submitting application..." : "Submit application"}
      </button>
    </form>
  );
}
