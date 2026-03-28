// @vitest-environment node

import {
  ApplicationStatus,
  HoldStatus,
  RoleStatus,
} from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { selectInterviewSlot } from "@/lib/applications/service";
import { prisma } from "@/lib/prisma/client";
import { disconnectDatabase, resetDatabase } from "@/tests/helpers/db";

async function seedRole() {
  return prisma.role.create({
    data: {
      slug: "test-role",
      title: "AI Product Operator",
      team: "Product",
      location: "Nepal",
      remoteStatus: "Remote",
      experienceLevel: "Senior",
      summary: "Test role",
      responsibilities: ["Ship tools"],
      requirements: ["Write code"],
      status: RoleStatus.OPEN,
    },
  });
}

describe("selectInterviewSlot", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it("prevents two candidates from confirming the same slot", async () => {
    const role = await seedRole();
    const startsAt = new Date("2026-03-30T04:15:00.000Z");
    const endsAt = new Date("2026-03-30T05:00:00.000Z");

    const [applicationOne, applicationTwo] = await Promise.all([
      prisma.application.create({
        data: {
          fullName: "Candidate One",
          email: "one@example.com",
          linkedinUrl: "https://linkedin.com/in/one",
          status: ApplicationStatus.INTERVIEW_PENDING,
          roleId: role.id,
        },
      }),
      prisma.application.create({
        data: {
          fullName: "Candidate Two",
          email: "two@example.com",
          linkedinUrl: "https://linkedin.com/in/two",
          status: ApplicationStatus.INTERVIEW_PENDING,
          roleId: role.id,
        },
      }),
    ]);

    const [planOne, planTwo] = await Promise.all([
      prisma.interviewPlan.create({
        data: {
          applicationId: applicationOne.id,
          interviewerName: "Jordan Lee",
          interviewerEmail: "jordan@example.com",
          interviewerCalendarId: "demo-calendar",
        },
      }),
      prisma.interviewPlan.create({
        data: {
          applicationId: applicationTwo.id,
          interviewerName: "Jordan Lee",
          interviewerEmail: "jordan@example.com",
          interviewerCalendarId: "demo-calendar",
        },
      }),
    ]);

    const holdOne = await prisma.interviewSlotHold.create({
      data: {
        interviewPlanId: planOne.id,
        token: "token-one",
        startsAt,
        endsAt,
        expiresAt: new Date("2026-03-31T04:15:00.000Z"),
        status: HoldStatus.HELD,
        googleCalendarEventId: "hold-one",
      },
    });

    await prisma.interviewSlotHold.create({
      data: {
        interviewPlanId: planTwo.id,
        token: "token-two",
        startsAt,
        endsAt,
        expiresAt: new Date("2026-03-31T04:15:00.000Z"),
        status: HoldStatus.HELD,
        googleCalendarEventId: "hold-two",
      },
    });

    await selectInterviewSlot(holdOne.token);

    await expect(selectInterviewSlot("token-two")).rejects.toThrow(
      "Another candidate already confirmed this slot.",
    );

    const updatedApplication = await prisma.application.findUniqueOrThrow({
      where: { id: applicationOne.id },
    });
    const updatedHold = await prisma.interviewSlotHold.findUniqueOrThrow({
      where: { token: holdOne.token },
    });

    expect(updatedApplication.status).toBe(ApplicationStatus.INTERVIEW_SCHEDULED);
    expect(updatedHold.status).toBe(HoldStatus.CONFIRMED);
  });

  it("blocks overlapping confirmed slots even when the start times differ", async () => {
    const role = await seedRole();

    const [applicationOne, applicationTwo] = await Promise.all([
      prisma.application.create({
        data: {
          fullName: "Overlap One",
          email: "overlap-one@example.com",
          linkedinUrl: "https://linkedin.com/in/overlap-one",
          status: ApplicationStatus.INTERVIEW_PENDING,
          roleId: role.id,
        },
      }),
      prisma.application.create({
        data: {
          fullName: "Overlap Two",
          email: "overlap-two@example.com",
          linkedinUrl: "https://linkedin.com/in/overlap-two",
          status: ApplicationStatus.INTERVIEW_PENDING,
          roleId: role.id,
        },
      }),
    ]);

    const [planOne, planTwo] = await Promise.all([
      prisma.interviewPlan.create({
        data: {
          applicationId: applicationOne.id,
          interviewerName: "Jordan Lee",
          interviewerEmail: "jordan@example.com",
          interviewerCalendarId: "demo-calendar",
        },
      }),
      prisma.interviewPlan.create({
        data: {
          applicationId: applicationTwo.id,
          interviewerName: "Jordan Lee",
          interviewerEmail: "jordan@example.com",
          interviewerCalendarId: "demo-calendar",
        },
      }),
    ]);

    await prisma.interviewSlotHold.create({
      data: {
        interviewPlanId: planOne.id,
        token: "overlap-confirmed",
        startsAt: new Date("2026-03-30T04:15:00.000Z"),
        endsAt: new Date("2026-03-30T05:00:00.000Z"),
        expiresAt: new Date("2026-03-31T04:15:00.000Z"),
        status: HoldStatus.CONFIRMED,
        googleCalendarEventId: "confirmed-overlap",
      },
    });

    await prisma.interviewSlotHold.create({
      data: {
        interviewPlanId: planTwo.id,
        token: "overlap-held",
        startsAt: new Date("2026-03-30T04:30:00.000Z"),
        endsAt: new Date("2026-03-30T05:15:00.000Z"),
        expiresAt: new Date("2026-03-31T04:15:00.000Z"),
        status: HoldStatus.HELD,
        googleCalendarEventId: "held-overlap",
      },
    });

    await expect(selectInterviewSlot("overlap-held")).rejects.toThrow(
      "Another candidate already confirmed this slot.",
    );
  });
});
