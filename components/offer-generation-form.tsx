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
      <div className="grid gap-3 md:grid-cols-2">
        <input className="field" onChange={(event) => setForm((current) => ({ ...current, jobTitle: event.target.value }))} placeholder="Job title" value={form.jobTitle} />
        <input className="field" onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} type="date" value={form.startDate} />
        <input className="field" onChange={(event) => setForm((current) => ({ ...current, baseSalary: event.target.value }))} placeholder="Base salary" value={form.baseSalary} />
        <input className="field" onChange={(event) => setForm((current) => ({ ...current, reportingManager: event.target.value }))} placeholder="Reporting manager" value={form.reportingManager} />
        <input className="field" onChange={(event) => setForm((current) => ({ ...current, equityBonus: event.target.value }))} placeholder="Equity or bonus" value={form.equityBonus} />
        <input className="field" onChange={(event) => setForm((current) => ({ ...current, compensationNotes: event.target.value }))} placeholder="Compensation notes" value={form.compensationNotes} />
      </div>
      <textarea
        className="field min-h-24"
        onChange={(event) => setForm((current) => ({ ...current, customTerms: event.target.value }))}
        placeholder="Custom terms or candidate-specific conditions"
        value={form.customTerms}
      />
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
        {isPending ? "Generating..." : "Generate offer"}
      </button>
    </div>
  );
}
