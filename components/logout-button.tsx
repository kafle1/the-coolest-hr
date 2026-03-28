"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);

    try {
      await fetch("/api/admin/auth/logout", { method: "POST" });
      router.push("/admin/login");
      router.refresh();
    } catch {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className="rounded-full border border-black/8 px-4 py-2 text-sm font-semibold transition hover:bg-red-50 hover:border-red-200 hover:text-red-700"
    >
      {loading ? "Signing out…" : "Sign out"}
    </button>
  );
}
