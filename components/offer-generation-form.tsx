"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cn } from "@/lib/utils/cn";

export function OfferGenerationForm({
  applicationId,
  roleTitle,
  className,
}: {
  applicationId: string;
  roleTitle: string;
  className?: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    jobTitle: roleTitle,
    startDate: "",
    baseSalary: "NPR 300,000 / month",
    compensationNotes: "",
    equityBonus: "",
    reportingManager: "Jordan Lee",
    customTerms: "",
    sendNow: true,
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className={cn("grid gap-3", className ?? "surface-panel p-4")}>
      <div>
        <h3 className="text-base font-semibold">Offer inputs</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Confirm the final role, compensation, manager, and any custom terms before generating the letter.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold">
          Job title
          <input className="field" onChange={(event) => setForm((current) => ({ ...current, jobTitle: event.target.value }))} placeholder="Job title" value={form.jobTitle} />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Start date
          <input className="field" onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} type="date" value={form.startDate} />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Base salary
          <input className="field" onChange={(event) => setForm((current) => ({ ...current, baseSalary: event.target.value }))} placeholder="Base salary" value={form.baseSalary} />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Reporting manager
          <input className="field" onChange={(event) => setForm((current) => ({ ...current, reportingManager: event.target.value }))} placeholder="Reporting manager" value={form.reportingManager} />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Equity or bonus
          <input className="field" onChange={(event) => setForm((current) => ({ ...current, equityBonus: event.target.value }))} placeholder="Optional equity or bonus details" value={form.equityBonus} />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Compensation notes
          <input className="field" onChange={(event) => setForm((current) => ({ ...current, compensationNotes: event.target.value }))} placeholder="Optional compensation notes" value={form.compensationNotes} />
        </label>
      </div>
      <label className="grid gap-2 text-sm font-semibold">
        Custom terms
        <textarea
          className="field min-h-24"
          onChange={(event) => setForm((current) => ({ ...current, customTerms: event.target.value }))}
          placeholder="Candidate-specific terms, conditions, or notes"
          value={form.customTerms}
        />
      </label>
      <label className="flex items-center gap-3 text-sm font-semibold">
        <input
          checked={form.sendNow}
          onChange={(event) =>
            setForm((current) => ({ ...current, sendNow: event.target.checked }))
          }
          type="checkbox"
        />
        Mark the offer as sent immediately after generation
      </label>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      <button
        className="button-secondary w-full sm:w-fit"
        disabled={isPending}
        onClick={() => {
          setError(null);
          setMessage(null);

          startTransition(async () => {
            try {
              const response = await fetch(`/api/offers/${applicationId}/generate`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(form),
              });
              const payload = (await response.json()) as { message?: string };

              if (!response.ok) {
                throw new Error(payload.message ?? "Unable to generate offer.");
              }

              setMessage(form.sendNow ? "Offer generated and sent." : "Offer draft generated.");
              router.refresh();
            } catch (submissionError) {
              setError(
                submissionError instanceof Error
                  ? submissionError.message
                  : "Unable to generate offer.",
              );
            }
          });
        }}
        type="button"
      >
        {isPending ? "Generating..." : form.sendNow ? "Generate and send offer" : "Generate offer draft"}
      </button>
    </div>
  );
}
