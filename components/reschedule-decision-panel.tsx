"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function RescheduleDecisionPanel({
  applicationId,
  requestNote,
}: {
  applicationId: string;
  requestNote: string;
}) {
  const router = useRouter();
  const [approvedStartsAt, setApprovedStartsAt] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function runAction(action: "send-options" | "approve-time") {
    setError(null);
    setMessage(null);

    startTransition(async () => {
      try {
        let response: Response;

        if (action === "approve-time") {
          if (!approvedStartsAt) {
            throw new Error("Choose the approved interview time first.");
          }

          response = await fetch(`/api/interviews/${applicationId}/approve-reschedule`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              startsAt: new Date(approvedStartsAt).toISOString(),
            }),
          });
        } else {
          response = await fetch(`/api/interviews/${applicationId}/send-options`, {
            method: "POST",
          });
        }

        const payload = (await response.json()) as { message?: string };

        if (!response.ok) {
          throw new Error(payload.message ?? "Unable to complete the reschedule action.");
        }

        setMessage(
          action === "approve-time"
            ? "Approved time scheduled and invite sent."
            : "Alternative interview options sent to the candidate.",
        );
        router.refresh();
      } catch (submissionError) {
        setError(
          submissionError instanceof Error
            ? submissionError.message
            : "Unable to complete the reschedule action.",
        );
      }
    });
  }

  return (
    <div className="surface-panel grid gap-4 p-4">
      <div className="text-sm">
        <p className="font-semibold">Candidate reschedule request</p>
        <p className="mt-2 text-[var(--muted)]">{requestNote}</p>
      </div>
      <p className="text-sm text-[var(--muted)]">
        Approve a new time directly if the interviewer has already agreed, or send a fresh set of options back to the candidate.
      </p>

      <label className="grid gap-2 text-sm font-semibold">
        Approved interview time
        <input
          className="field"
          onChange={(event) => setApprovedStartsAt(event.target.value)}
          type="datetime-local"
          value={approvedStartsAt}
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <button
          className="button-primary"
          disabled={isPending}
          onClick={() => runAction("approve-time")}
          type="button"
        >
          {isPending ? "Scheduling..." : "Schedule approved time"}
        </button>
        <button
          className="button-secondary"
          disabled={isPending}
          onClick={() => runAction("send-options")}
          type="button"
        >
          {isPending ? "Sending..." : "Send alternative options"}
        </button>
      </div>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
    </div>
  );
}
