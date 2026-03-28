"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cn } from "@/lib/utils/cn";

export function FeedbackForm({
  applicationId,
  className,
}: {
  applicationId: string;
  className?: string;
}) {
  const router = useRouter();
  const [authorName, setAuthorName] = useState("Jordan Lee");
  const [authorRole, setAuthorRole] = useState("Hiring Manager");
  const [content, setContent] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className={cn("grid gap-3", className ?? "surface-panel p-4")}>
      <div>
        <h3 className="text-base font-semibold">Interviewer feedback</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Save structured interview notes here. The system will review the wording and flag vague or biased phrasing.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold">
          Interviewer name
          <input className="field" onChange={(event) => setAuthorName(event.target.value)} placeholder="Author name" value={authorName} />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Interviewer role
          <input className="field" onChange={(event) => setAuthorRole(event.target.value)} placeholder="Role" value={authorRole} />
        </label>
      </div>
      <label className="grid gap-2 text-sm font-semibold">
        Feedback
        <textarea
          className="field min-h-32"
          onChange={(event) => setContent(event.target.value)}
          placeholder="Summarize evidence, strengths, risks, and your recommendation."
          value={content}
        />
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
              const response = await fetch(`/api/admin/applications/${applicationId}/feedback`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  authorName,
                  authorRole,
                  content,
                }),
              });
              const payload = (await response.json()) as { message?: string };

              if (!response.ok) {
                throw new Error(payload.message ?? "Unable to store feedback.");
              }

              setMessage("Feedback stored and evaluated.");
              setContent("");
              router.refresh();
            } catch (submissionError) {
              setError(
                submissionError instanceof Error
                  ? submissionError.message
                  : "Unable to store feedback.",
              );
            }
          });
        }}
        type="button"
      >
        {isPending ? "Saving..." : "Save feedback"}
      </button>
    </div>
  );
}
