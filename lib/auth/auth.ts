import { timingSafeEqual } from "node:crypto";

import { env } from "@/lib/utils/env";

function safelyCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyCredentials(email: string, password: string): boolean {
  if (!env.adminEmail || !env.adminPassword) {
    return false;
  }

  return safelyCompare(email.trim().toLowerCase(), env.adminEmail.toLowerCase()) && safelyCompare(password, env.adminPassword);
}
