import { cn } from "@/lib/utils/cn";
import { formatStatusLabel } from "@/lib/utils/format";

const toneMap: Record<string, string> = {
  OPEN: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  PAUSED: "bg-amber-50 text-amber-700 ring-amber-100",
  CLOSED: "bg-slate-100 text-slate-700 ring-slate-200",
  APPLIED: "bg-slate-100 text-slate-700 ring-slate-200",
  SCREENED: "bg-blue-50 text-blue-700 ring-blue-100",
  SHORTLISTED: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  INTERVIEW_PENDING: "bg-amber-50 text-amber-700 ring-amber-100",
  INTERVIEW_SCHEDULED: "bg-cyan-50 text-cyan-700 ring-cyan-100",
  INTERVIEW_COMPLETED: "bg-violet-50 text-violet-700 ring-violet-100",
  OFFER_DRAFT: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-100",
  OFFER_SENT: "bg-orange-50 text-orange-700 ring-orange-100",
  OFFER_SIGNED: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  SLACK_INVITED: "bg-teal-50 text-teal-700 ring-teal-100",
  ONBOARDED: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  REJECTED: "bg-rose-50 text-rose-700 ring-rose-100",
};

export function StatusBadge({ value }: { value: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-3 py-1 text-xs font-semibold tracking-wide ring-1 ring-inset",
        toneMap[value] ?? "bg-slate-100 text-slate-700 ring-slate-200",
      )}
    >
      {formatStatusLabel(value)}
    </span>
  );
}
