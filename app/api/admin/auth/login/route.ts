import { NextResponse } from "next/server";

import { verifyCredentials } from "@/lib/auth/auth";
import { createSession } from "@/lib/auth/session";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`login:${ip}`, 10, 60_000);

  if (!limit.success) {
    return NextResponse.json(
      { ok: false, message: "Too many login attempts. Please try again later." },
      { status: 429 },
    );
  }

  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json(
        { ok: false, message: "Email and password are required." },
        { status: 400 },
      );
    }

    if (!verifyCredentials(email, password)) {
      return NextResponse.json(
        { ok: false, message: "Invalid email or password." },
        { status: 401 },
      );
    }

    await createSession(email);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { ok: false, message: "An unexpected error occurred." },
      { status: 500 },
    );
  }
}
