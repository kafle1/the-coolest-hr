import { NextResponse } from "next/server";
import { ApplicationStatus } from "@prisma/client";

import { listAdminApplications } from "@/lib/applications/service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status = statusParam && statusParam in ApplicationStatus
    ? (statusParam as ApplicationStatus)
    : undefined;

  const applications = await listAdminApplications({
    roleId: url.searchParams.get("roleId") ?? undefined,
    status,
    startDate: url.searchParams.get("startDate") ?? undefined,
    endDate: url.searchParams.get("endDate") ?? undefined,
  });

  return NextResponse.json({
    ok: true,
    applications,
  });
}
