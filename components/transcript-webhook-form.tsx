"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cn } from "@/lib/utils/cn";

export function TranscriptWebhookForm({
  applicationId,
  className,
  defaultMeetingId,
}: {
  applicationId: string;
  className?: string;
  defaultMeetingId?: string | null;
}) {
  const router = useRouter();
  const [meetingId, setMeetingId] = useState(defaultMeetingId ?? "");
  const [transcriptText, setTranscriptText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const trimmedMeetingId = meetingId.trim();
  const trimmedTranscriptText = transcriptText.trim();
  const canSubmit = Boolean(trimmedMeetingId || trimmedTranscriptText || defaultMeetingId);
  const buttonLabel = trimmedTranscriptText
    ? "Store transcript"
    : trimmedMeetingId || defaultMeetingId
      ? "Fetch Fireflies transcript"
      : "Store transcript";

  return (
    <div className={cn("grid gap-3", className ?? "surface-panel p-4")}>
      <label className="grid gap-2 text-sm font-semibold">
        Fireflies meeting ID
        <input
          className="field"
          onChange={(event) => setMeetingId(event.target.value)}
          placeholder="If Fireflies already joined, this can stay prefilled"
          value={meetingId}
        />
      </label>
      <label className="grid gap-2 text-sm font-semibold">
        Paste transcript or interview notes
        <textarea
          className="field"
          onChange={(event) => setTranscriptText(event.target.value)}
          placeholder="Paste the full transcript or concise interviewer notes here..."
          rows={5}
          value={transcriptText}
        />
      </label>
      <p className="text-sm text-[var(--muted)]">
        Fireflies transcript fetch uses the meeting ID above. Pasted notes work too and will move
        the candidate to interview completed as soon as the transcript is stored.
      </p>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      <button
        className="button-secondary w-full sm:w-fit"
        disabled={isPending || !canSubmit}
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
                  providerMeetingId: trimmedMeetingId || undefined,
                  directText: trimmedTranscriptText || undefined,
                }),
              });
              const payload = (await response.json()) as { message?: string };

              if (!response.ok) {
                throw new Error(payload.message ?? "Unable to ingest transcript.");
              }

              setMessage(payload.message ?? "Transcript stored successfully.");
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
        {isPending ? "Processing..." : buttonLabel}
      </button>
    </div>
  );
}
