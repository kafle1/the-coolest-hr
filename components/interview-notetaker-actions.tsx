"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function InterviewNotetakerActions({
  applicationId,
}: {
  applicationId: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function runAction(path: string, fallbackError: string) {
    const response = await fetch(path, { method: "POST" });
    const payload = (await response.json()) as { message?: string };

    if (!response.ok) {
      throw new Error(payload.message ?? fallbackError);
    }

    setMessage(payload.message ?? "Done.");
    router.refresh();
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-[var(--muted)]">
        Use these controls to trigger the Fireflies notetaker or refresh its current sync state.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          className="button-secondary w-full sm:w-fit"
          disabled={isPending}
          onClick={() => {
            setError(null);
            setMessage(null);

            startTransition(async () => {
              try {
                await runAction(
                  `/api/interviews/${applicationId}/start-notetaker`,
                  "Unable to start Fireflies.",
                );
              } catch (submissionError) {
                setError(
                  submissionError instanceof Error
                    ? submissionError.message
                    : "Unable to start Fireflies.",
                );
              }
            });
        }}
        type="button"
      >
          {isPending ? "Starting..." : "Start Fireflies notetaker"}
        </button>

        <button
          className="button-secondary w-full sm:w-fit"
          disabled={isPending}
          onClick={() => {
            setError(null);
            setMessage(null);

            startTransition(async () => {
              try {
                await runAction(
                  `/api/interviews/${applicationId}/sync-notetaker`,
                  "Unable to sync Fireflies status.",
                );
              } catch (submissionError) {
                setError(
                  submissionError instanceof Error
                    ? submissionError.message
                    : "Unable to sync Fireflies status.",
                );
              }
            });
        }}
        type="button"
      >
          {isPending ? "Checking..." : "Refresh Fireflies status"}
        </button>
      </div>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
    </div>
  );
}
