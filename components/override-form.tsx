"use client";

import { ApplicationStatus } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { cn } from "@/lib/utils/cn";

export function OverrideForm({
  applicationId,
  currentStatus,
  targets,
  className,
}: {
  applicationId: string;
  currentStatus: ApplicationStatus;
  targets: ApplicationStatus[];
  className?: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<ApplicationStatus | "">(targets[0] ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setStatus(targets[0] ?? "");
  }, [targets]);

  return (
    <div className={cn("grid gap-3", className ?? "surface-panel p-4")}>
      <p className="text-sm text-[var(--muted)]">
        Manual override targets are limited to valid decision-state moves from {currentStatus}.
      </p>
      <div className="grid gap-3 md:grid-cols-[180px_1fr]">
        <select
          className="field"
          disabled={targets.length === 0}
          onChange={(event) => setStatus(event.target.value as ApplicationStatus)}
          value={status}
        >
          {targets.length === 0 ? (
            <option value="">No valid overrides</option>
          ) : null}
          {targets.map((target) => (
            <option key={target} value={target}>
              {target}
            </option>
          ))}
        </select>
        <textarea
          className="field min-h-28"
          onChange={(event) => setNote(event.target.value)}
          placeholder="Explain the override with a concrete note."
          value={note}
        />
      </div>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      <button
        className="button-secondary w-full sm:w-fit"
        disabled={isPending || !status}
        onClick={() => {
          setError(null);
          setMessage(null);

          startTransition(async () => {
            try {
              if (!status) {
                throw new Error("No valid overrides are available for this candidate.");
              }

              const response = await fetch(`/api/admin/applications/${applicationId}/override`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  status,
                  note,
                }),
              });
              const payload = (await response.json()) as { message?: string };

              if (!response.ok) {
                throw new Error(payload.message ?? "Unable to override application.");
              }

              setMessage("Override saved.");
              setNote("");
              router.refresh();
            } catch (submissionError) {
              setError(
                submissionError instanceof Error
                  ? submissionError.message
                  : "Unable to override application.",
              );
            }
          });
        }}
        type="button"
      >
        {isPending ? "Saving..." : "Apply override"}
      </button>
    </div>
  );
}
