"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

const publicLinks = [
  { href: "/", label: "Open roles" },
  { href: "/apply", label: "Apply" },
  { href: "/candidates/status", label: "Application tracker" },
];

function NavLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("button-ghost", active && "button-ghost-active")}
    >
      {label}
    </Link>
  );
}

function PublicHeader({ pathname }: { pathname: string }) {
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
          Browse open roles, submit one clear application, and track progress without chasing updates.
        </p>
      </div>
      <nav className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--ink)]">
        {publicLinks.map((link) => (
          <NavLink
            key={link.href}
            href={link.href}
            label={link.label}
            active={pathname === link.href}
          />
        ))}
      </nav>
    </header>
  );
}

function AdminHeader({ pathname }: { pathname: string }) {
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
          Internal workspace for intake, scheduling, offers, and onboarding.
        </p>
      </div>
      <nav className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--ink)]">
        <NavLink href="/admin" label="Dashboard" active={pathname === "/admin"} />
        <Link href="/" className="button-secondary">
          View candidate site
        </Link>
      </nav>
    </header>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const isAdminRoute = pathname.startsWith("/admin");

  return isAdminRoute ? <AdminHeader pathname={pathname} /> : <PublicHeader pathname={pathname} />;
}
