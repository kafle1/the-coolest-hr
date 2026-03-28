// @vitest-environment node

import {
  ApplicationStatus,
  HoldStatus,
  RoleStatus,
} from "@prisma/client";
import { addDays, subHours } from "date-fns";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { processInterviewSchedulingNudges } from "@/lib/applications/service";
import { prisma } from "@/lib/prisma/client";
import { disconnectDatabase, resetDatabase } from "@/tests/helpers/db";

async function seedRole() {
  return prisma.role.create({
    data: {
      slug: `nudge-role-${Math.random().toString(36).slice(2, 8)}`,
      title: "AI Product Operator",
      team: "Product",
      location: "Nepal",
      remoteStatus: "Remote",
      experienceLevel: "Senior",
      summary: "Nudge role",
      responsibilities: ["Ship tools"],
      requirements: ["Write code"],
      status: RoleStatus.OPEN,
    },
  });
}

describe("processInterviewSchedulingNudges", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it("sends one overdue nudge and records the follow-up state", async () => {
    const role = await seedRole();
    const now = new Date("2026-04-01T12:00:00.000Z");
    const application = await prisma.application.create({
      data: {
        fullName: "Nudge Candidate",
        email: "nudge@example.com",
        linkedinUrl: "https://linkedin.com/in/nudge",
        status: ApplicationStatus.INTERVIEW_PENDING,
        roleId: role.id,
        interviewPlan: {
          create: {
            interviewerName: "Jordan Lee",
            interviewerEmail: "jordan.lee@example.com",
            interviewerCalendarId: "demo-calendar",
            lastOptionsSentAt: subHours(now, 49),
          },
        },
      },
      include: {
        interviewPlan: true,
      },
    });

    await prisma.interviewSlotHold.create({
      data: {
        interviewPlanId: application.interviewPlan!.id,
        token: "nudge-token",
        startsAt: addDays(now, 1),
        endsAt: addDays(now, 1),
        expiresAt: addDays(now, 2),
        status: HoldStatus.HELD,
      },
    });

    const result = await processInterviewSchedulingNudges(now);

    expect(result.nudgedCount).toBe(1);
    expect(result.nudgedApplicationIds).toEqual([application.id]);

    const refreshedPlan = await prisma.interviewPlan.findUniqueOrThrow({
      where: { id: application.interviewPlan!.id },
    });
    const emailLog = await prisma.emailLog.findFirstOrThrow({
      where: {
        applicationId: application.id,
        templateKey: "scheduling-nudge",
      },
    });
    const statusNote = await prisma.statusHistory.findFirstOrThrow({
      where: {
        applicationId: application.id,
        actorLabel: "Scheduling nudge",
      },
    });

    expect(refreshedPlan.lastNudgeAt?.toISOString()).toBe(now.toISOString());
    expect(emailLog.subject).toContain("Reminder");
    expect(statusNote.note).toContain("48-hour interview scheduling follow-up");

    const secondPass = await processInterviewSchedulingNudges(now);
    const emailCount = await prisma.emailLog.count({
      where: {
        applicationId: application.id,
        templateKey: "scheduling-nudge",
      },
    });

    expect(secondPass.nudgedCount).toBe(0);
    expect(emailCount).toBe(1);
  });

  it("skips released, expired, and confirmed scheduling holds", async () => {
    const role = await seedRole();
    const now = new Date("2026-04-01T12:00:00.000Z");

    const applications = await Promise.all(
      ["released", "expired", "confirmed"].map((label) =>
        prisma.application.create({
          data: {
            fullName: `${label} Candidate`,
            email: `${label}@example.com`,
            linkedinUrl: `https://linkedin.com/in/${label}`,
            status: ApplicationStatus.INTERVIEW_PENDING,
            roleId: role.id,
            interviewPlan: {
              create: {
                interviewerName: "Jordan Lee",
                interviewerEmail: "jordan.lee@example.com",
                interviewerCalendarId: "demo-calendar",
                lastOptionsSentAt: subHours(now, 50),
              },
            },
          },
          include: {
            interviewPlan: true,
          },
        }),
      ),
    );

    await Promise.all([
      prisma.interviewSlotHold.create({
        data: {
          interviewPlanId: applications[0]!.interviewPlan!.id,
          token: "released-token",
          startsAt: addDays(now, 1),
          endsAt: addDays(now, 1),
          expiresAt: addDays(now, 2),
          status: HoldStatus.RELEASED,
        },
      }),
      prisma.interviewSlotHold.create({
        data: {
          interviewPlanId: applications[1]!.interviewPlan!.id,
          token: "expired-token",
          startsAt: addDays(now, 1),
          endsAt: addDays(now, 1),
          expiresAt: subHours(now, 1),
          status: HoldStatus.HELD,
        },
      }),
      prisma.interviewSlotHold.create({
        data: {
          interviewPlanId: applications[2]!.interviewPlan!.id,
          token: "confirmed-token",
          startsAt: addDays(now, 1),
          endsAt: addDays(now, 1),
          expiresAt: addDays(now, 2),
          status: HoldStatus.CONFIRMED,
        },
      }),
    ]);

    const result = await processInterviewSchedulingNudges(now);
    const emailCount = await prisma.emailLog.count({
      where: { templateKey: "scheduling-nudge" },
    });

    expect(result.nudgedCount).toBe(0);
    expect(emailCount).toBe(0);
  });
});
