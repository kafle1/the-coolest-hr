"use client";

import Link from "next/link";
import { useState, Suspense } from "react";

import { SectionCard } from "@/components/section-card";
import { StatusBadge } from "@/components/status-badge";

interface StatusApplication {
  id: string;
  roleTitle: string;
  status: string;
  submittedAt: string;
}

function StatusLookupForm() {
  const [email, setEmail] = useState("");
  const [applications, setApplications] = useState<StatusApplication[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    setSearched(false);

    try {
      const res = await fetch(`/api/applications/status?email=${encodeURIComponent(email.trim())}`);
      const data = await res.json();

      if (!data.ok) {
        setError(data.message || "Unable to look up applications.");
        setApplications(null);
      } else {
        setApplications(data.applications);
      }

      setSearched(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-8">
      <SectionCard
        eyebrow="Application tracker"
        title="Check your application status"
        description="Enter the email address you used when applying to see where each application sits in the hiring pipeline."
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 sm:flex-row">
          <input
            className="field flex-1"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email address"
            required
            autoFocus
          />
          <button type="submit" disabled={loading} className="button-primary whitespace-nowrap">
            {loading ? "Looking up…" : "Check status"}
          </button>
        </form>

        {error && (
          <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {searched && applications !== null && (
          <div className="mt-6">
            {applications.length === 0 ? (
              <div className="surface-panel px-5 py-12 text-center text-sm text-[var(--muted)]">
                No applications found for this email address.
              </div>
            ) : (
              <div className="grid gap-4">
                {applications.map((app) => (
                  <div
                    key={app.id}
                    className="surface-panel flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-semibold">{app.roleTitle}</p>
                      <p className="text-sm text-[var(--muted)]">
                        Applied{" "}
                        {new Date(app.submittedAt).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </p>
                    </div>
                    <StatusBadge value={app.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </SectionCard>

      <div className="text-center">
        <Link href="/apply" className="button-secondary">
          Submit a new application
        </Link>
      </div>
    </div>
  );
}

export default function CandidateStatusPage() {
  return (
    <Suspense
      fallback={
        <div className="card rounded-[30px] p-8 text-center text-sm text-[var(--muted)]">
          Loading…
        </div>
      }
    >
      <StatusLookupForm />
    </Suspense>
  );
}
