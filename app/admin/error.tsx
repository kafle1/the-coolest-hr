"use client";

import { SectionCard } from "@/components/section-card";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="grid gap-8">
      <SectionCard
        eyebrow="Error"
        title="Something went wrong"
        description={error.message || "An unexpected error occurred in the admin dashboard."}
      >
        <div className="flex gap-3">
          <button onClick={reset} className="button-primary">
            Try again
          </button>
          <a href="/admin" className="button-secondary">
            Back to dashboard
          </a>
        </div>
      </SectionCard>
    </div>
  );
}
