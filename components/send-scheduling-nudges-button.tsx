"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type NudgePayload =
  | { ok: true; nudgedCount: number }
  | { ok: false; message?: string };

export function SendSchedulingNudgesButton() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="surface-panel p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="eyebrow">Scheduling follow-up</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Trigger the overdue 48-hour interview reminder processor for stale held slots.
          </p>
        </div>
        <button
          className="button-secondary"
          disabled={isPending}
          onClick={() => {
            setError(null);
            setMessage(null);

            startTransition(async () => {
              try {
                const response = await fetch("/api/interviews/nudges", {
                  method: "POST",
                });
                const payload = (await response.json()) as NudgePayload;

                if (!response.ok || !payload.ok) {
                  throw new Error(
                    "message" in payload
                      ? payload.message ?? "Unable to process scheduling nudges."
                      : "Unable to process scheduling nudges.",
                  );
                }

                setMessage(
                  payload.nudgedCount === 0
                    ? "No overdue interview reminders were pending."
                    : `Processed ${payload.nudgedCount} overdue scheduling reminder${payload.nudgedCount === 1 ? "" : "s"}.`,
                );
                router.refresh();
              } catch (submissionError) {
                setError(
                  submissionError instanceof Error
                    ? submissionError.message
                    : "Unable to process scheduling nudges.",
                );
              }
            });
          }}
          type="button"
        >
          {isPending ? "Processing..." : "Run overdue nudges"}
        </button>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
      {message ? <p className="mt-3 text-sm text-emerald-700">{message}</p> : null}
    </div>
  );
}
