"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function ScheduleSlotActions({
  token,
  canConfirm,
}: {
  token: string;
  canConfirm: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="grid gap-4">
      {canConfirm ? (
        <button
          className="button-primary w-full sm:w-fit"
          disabled={isPending}
          onClick={() => {
            setError(null);
            setMessage(null);

            startTransition(async () => {
              try {
                const response = await fetch(`/api/scheduling/select/${token}`, {
                  method: "POST",
                });
                const payload = (await response.json()) as { message?: string };

                if (!response.ok) {
                  throw new Error(payload.message ?? "Unable to confirm slot.");
                }

                setMessage("Slot confirmed. Your interview invite is now scheduled.");
                router.refresh();
              } catch (submissionError) {
                setError(
                  submissionError instanceof Error
                    ? submissionError.message
                    : "Unable to confirm slot.",
                );
              }
            });
          }}
          type="button"
        >
          {isPending ? "Confirming..." : "Confirm this slot"}
        </button>
      ) : null}

      <div className="surface-panel grid gap-3 p-4">
        <textarea
          className="field min-h-28"
          onChange={(event) => setNote(event.target.value)}
          placeholder="If none of the proposed times work, describe what does."
          value={note}
        />
        <button
          className="button-secondary w-full sm:w-fit"
          disabled={isPending}
          onClick={() => {
            setError(null);
            setMessage(null);

            startTransition(async () => {
              try {
                const response = await fetch(`/api/scheduling/reschedule/${token}`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ note }),
                });
                const payload = (await response.json()) as { message?: string };

                if (!response.ok) {
                  throw new Error(payload.message ?? "Unable to request reschedule.");
                }

                setMessage(payload.message ?? "Reschedule request sent.");
                setNote("");
                router.refresh();
              } catch (submissionError) {
                setError(
                  submissionError instanceof Error
                    ? submissionError.message
                    : "Unable to request reschedule.",
                );
              }
            });
          }}
          type="button"
        >
          {isPending ? "Sending..." : "Request a different time"}
        </button>
      </div>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
    </div>
  );
}
