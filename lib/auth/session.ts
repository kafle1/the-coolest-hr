import { cookies } from "next/headers";

import { createSessionToken, SESSION_MAX_AGE_SECONDS, verifySessionToken } from "@/lib/auth/session-token";

const COOKIE_NAME = "admin_session";

export async function createSession(email: string): Promise<void> {
  const token = await createSessionToken(email);
  const cookieStore = await cookies();

  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function getSession(): Promise<string | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME);

  if (!cookie?.value) {
    return null;
  }

  return verifySessionToken(cookie.value);
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
