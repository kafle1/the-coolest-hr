"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function SendInterviewOptionsButton({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="grid gap-3">
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      <button
        className="button-primary w-full sm:w-fit"
        disabled={isPending}
        onClick={() => {
          setError(null);
          setMessage(null);

          startTransition(async () => {
            try {
              const response = await fetch(`/api/interviews/${applicationId}/send-options`, {
                method: "POST",
              });
              const payload = (await response.json()) as { message?: string };

              if (!response.ok) {
                throw new Error(payload.message ?? "Unable to send interview options.");
              }

              setMessage("Scheduling options sent.");
              router.refresh();
            } catch (submissionError) {
              setError(
                submissionError instanceof Error
                  ? submissionError.message
                  : "Unable to send interview options.",
              );
            }
          });
        }}
        type="button"
      >
        {isPending ? "Sending..." : "Send interview options"}
      </button>
    </div>
  );
}
