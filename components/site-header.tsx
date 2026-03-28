"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function PublicHeader() {
  return (
    <header className="card mb-8 flex flex-col gap-5 rounded-[30px] px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <Link
          href="/"
          className="font-[family-name:var(--font-heading)] text-2xl font-semibold tracking-tight"
        >
          Niural Careers
        </Link>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Explore open roles, apply online, and check your application status.
        </p>
      </div>
      <nav className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--ink)]">
        <Link href="/" className="button-ghost">
          Careers
        </Link>
        <Link href="/apply" className="button-ghost">
          Apply
        </Link>
        <Link href="/candidates/status" className="button-ghost">
          Check Status
        </Link>
      </nav>
    </header>
  );
}

function AdminHeader() {
  return (
    <header className="card mb-8 flex flex-col gap-5 rounded-[30px] px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <Link
          href="/admin"
          className="font-[family-name:var(--font-heading)] text-2xl font-semibold tracking-tight"
        >
          Niural Hiring OS
        </Link>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Internal workspace for recruiting, scheduling, offers, and onboarding.
        </p>
      </div>
      <nav className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--ink)]">
        <Link href="/admin" className="button-ghost">
          Dashboard
        </Link>
        <Link href="/" className="button-secondary">
          View public site
        </Link>
      </nav>
    </header>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const isAdminRoute = pathname.startsWith("/admin");

  return isAdminRoute ? <AdminHeader /> : <PublicHeader />;
}
