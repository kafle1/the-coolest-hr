import { NextResponse } from "next/server";

import { HoldStatus } from "@prisma/client";

import { getCalendarService } from "@/lib/calendar/service";
import { prisma } from "@/lib/prisma/client";

export async function POST() {
  const now = new Date();

  const staleHolds = await prisma.interviewSlotHold.findMany({
    where: {
      status: HoldStatus.HELD,
      expiresAt: {
        lt: now,
      },
    },
    select: {
      id: true,
      googleCalendarEventId: true,
    },
  });

  if (staleHolds.length === 0) {
    return NextResponse.json({ expiredCount: 0 });
  }

  await prisma.interviewSlotHold.updateMany({
    where: {
      id: {
        in: staleHolds.map((hold) => hold.id),
      },
      status: HoldStatus.HELD,
    },
    data: {
      status: HoldStatus.EXPIRED,
    },
  });

  const calendar = getCalendarService();

  for (const hold of staleHolds) {
    if (hold.googleCalendarEventId) {
      await calendar.releaseHoldEvent(hold.googleCalendarEventId).catch(() => undefined);
    }
  }

  return NextResponse.json({ expiredCount: staleHolds.length });
}
