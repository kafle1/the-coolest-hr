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
      <div className="grid gap-3 md:grid-cols-2">
        <input className="field" onChange={(event) => setAuthorName(event.target.value)} placeholder="Author name" value={authorName} />
        <input className="field" onChange={(event) => setAuthorRole(event.target.value)} placeholder="Role" value={authorRole} />
      </div>
      <textarea
        className="field min-h-32"
        onChange={(event) => setContent(event.target.value)}
        placeholder="Write interview feedback here."
        value={content}
      />
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
