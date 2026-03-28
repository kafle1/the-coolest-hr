"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cn } from "@/lib/utils/cn";

export function TranscriptWebhookForm({
  applicationId,
  className,
}: {
  applicationId: string;
  className?: string;
}) {
  const router = useRouter();
  const [meetingId, setMeetingId] = useState("");
  const [transcriptText, setTranscriptText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className={cn("grid gap-3", className ?? "surface-panel p-4")}>
      <label className="grid gap-2 text-sm font-semibold">
        Fireflies meeting ID
        <input
          className="field"
          onChange={(event) => setMeetingId(event.target.value)}
          placeholder="Leave empty to use pasted transcript"
          value={meetingId}
        />
      </label>
      <label className="grid gap-2 text-sm font-semibold">
        Or paste transcript text
        <textarea
          className="field"
          onChange={(event) => setTranscriptText(event.target.value)}
          placeholder="Paste the full interview transcript here..."
          rows={5}
          value={transcriptText}
        />
      </label>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      <button
        className="button-secondary w-full sm:w-fit"
        disabled={isPending || (!meetingId.trim() && !transcriptText.trim())}
        onClick={() => {
          setError(null);
          setMessage(null);

          startTransition(async () => {
            try {
              const response = await fetch("/api/integrations/fireflies/webhook", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  applicationId,
                  providerMeetingId: meetingId.trim() || undefined,
                  directText: transcriptText.trim() || undefined,
                }),
              });
              const payload = (await response.json()) as { message?: string };

              if (!response.ok) {
                throw new Error(payload.message ?? "Unable to ingest transcript.");
              }

              setMessage("Transcript retrieved and stored.");
              router.refresh();
            } catch (submissionError) {
              setError(
                submissionError instanceof Error
                  ? submissionError.message
                  : "Unable to ingest transcript.",
              );
            }
          });
        }}
        type="button"
      >
        {isPending ? "Processing..." : "Ingest transcript"}
      </button>
    </div>
  );
}
