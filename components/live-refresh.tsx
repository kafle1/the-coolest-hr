"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils/cn";

export function LiveRefresh({
  enabled,
  intervalMs = 4000,
  mode = "hidden",
}: {
  enabled: boolean;
  intervalMs?: number;
  mode?: "hidden" | "inline";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "hidden") {
        return;
      }

      startTransition(() => {
        router.refresh();
      });
    }, intervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, intervalMs, router, startTransition]);

  if (mode === "hidden") {
    return null;
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-3 rounded-full border px-4 py-2 text-sm",
        enabled
          ? "border-[rgba(37,99,235,0.14)] bg-[rgba(37,99,235,0.08)] text-[var(--ink)]"
          : "border-[var(--border)] bg-[rgba(255,255,255,0.7)] text-[var(--muted)]",
      )}
    >
      {enabled ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-[rgba(37,99,235,0.22)] border-t-[var(--accent)]" />
      ) : (
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
      )}
      <span className="font-medium">
        {enabled ? (isPending ? "Syncing live updates" : "Watching for live updates") : "Up to date"}
      </span>
    </div>
  );
}
