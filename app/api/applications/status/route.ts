import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma/client";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";

export async function GET(request: Request) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`status:${ip}`, 15, 60_000);

  if (!limit.success) {
    return NextResponse.json(
      { ok: false, message: "Too many requests. Please try again later." },
      { status: 429 },
    );
  }

  const url = new URL(request.url);
  const email = url.searchParams.get("email")?.trim().toLowerCase();

  if (!email) {
    return NextResponse.json(
      { ok: false, message: "Email is required." },
      { status: 400 },
    );
  }

  const applications = await prisma.application.findMany({
    where: { email },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      role: {
        select: {
          title: true,
        },
      },
    },
    orderBy: { submittedAt: "desc" },
  });

  return NextResponse.json({
    ok: true,
    applications: applications.map((app) => ({
      id: app.id,
      roleTitle: app.role.title,
      status: app.status,
      submittedAt: app.submittedAt.toISOString(),
    })),
  });
}
