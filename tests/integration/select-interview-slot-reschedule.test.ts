// @vitest-environment node

import {
  ApplicationStatus,
  HoldStatus,
  RoleStatus,
} from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { confirmHoldEventMock, releaseHoldEventMock, sendInterviewRescheduleAlertMock } = vi.hoisted(() => ({
  confirmHoldEventMock: vi.fn(),
  releaseHoldEventMock: vi.fn(),
  sendInterviewRescheduleAlertMock: vi.fn(),
}));

vi.mock("@/lib/calendar/service", () => ({
  getCalendarService: () => ({
    assertInterviewSchedulingReady: vi.fn(),
    findAvailableSlots: vi.fn(),
    createHoldEvent: vi.fn(),
    confirmHoldEvent: confirmHoldEventMock,
    releaseHoldEvent: releaseHoldEventMock,
    getAttendeeResponseStatus: vi.fn(),
  }),
}));

vi.mock("@/lib/email/service", () => ({
  sendApplicationConfirmation: vi.fn(),
  sendInterviewConfirmationEmail: vi.fn(),
  sendInterviewRescheduleAlert: sendInterviewRescheduleAlertMock,
  sendSchedulingNudgeEmail: vi.fn(),
  sendSchedulingOptionsEmail: vi.fn(),
}));

import { requestInterviewReschedule, selectInterviewSlot } from "@/lib/applications/service";
import { prisma } from "@/lib/prisma/client";
import { disconnectDatabase, resetDatabase } from "@/tests/helpers/db";

describe("selectInterviewSlot replacement flow", () => {
  beforeEach(async () => {
    await resetDatabase();
    confirmHoldEventMock.mockResolvedValue({
      eventId: "new-confirmed-event",
      meetingUrl: "https://meet.google.com/new-confirmed-event",
    });
    releaseHoldEventMock.mockResolvedValue(undefined);
    sendInterviewRescheduleAlertMock.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it("releases the previously confirmed hold when a replacement slot is selected", async () => {
    const role = await prisma.role.create({
      data: {
        slug: "replacement-role",
        title: "AI Product Operator",
        team: "Product",
        location: "Nepal",
        remoteStatus: "Remote",
        experienceLevel: "Senior",
        summary: "Replacement role",
        responsibilities: ["Ship tools"],
        requirements: ["Write code"],
        status: RoleStatus.OPEN,
      },
    });
    const application = await prisma.application.create({
      data: {
        fullName: "Replacement Candidate",
        email: "replacement@example.com",
        linkedinUrl: "https://linkedin.com/in/replacement",
        status: ApplicationStatus.INTERVIEW_PENDING,
        roleId: role.id,
      },
    });
    const interviewPlan = await prisma.interviewPlan.create({
      data: {
        applicationId: application.id,
        interviewerName: "Jordan Lee",
        interviewerEmail: "jordan@example.com",
        interviewerCalendarId: "demo-calendar",
        candidateRequestNote: "I need a later time.",
      },
    });

    await prisma.interviewSlotHold.create({
      data: {
        interviewPlanId: interviewPlan.id,
        token: "previous-confirmed",
        startsAt: new Date("2026-03-30T04:15:00.000Z"),
        endsAt: new Date("2026-03-30T05:00:00.000Z"),
        expiresAt: new Date("2026-03-31T04:15:00.000Z"),
        status: HoldStatus.CONFIRMED,
        googleCalendarEventId: "old-confirmed-event",
      },
    });
    await prisma.interview.create({
      data: {
        applicationId: application.id,
        interviewPlanId: interviewPlan.id,
        startsAt: new Date("2026-03-30T04:15:00.000Z"),
        endsAt: new Date("2026-03-30T05:00:00.000Z"),
        googleEventId: "old-confirmed-event",
        meetingUrl: "https://meet.google.com/old-confirmed-event",
      },
    });

    const replacementHold = await prisma.interviewSlotHold.create({
      data: {
        interviewPlanId: interviewPlan.id,
        token: "replacement-held",
        startsAt: new Date("2026-03-31T04:15:00.000Z"),
        endsAt: new Date("2026-03-31T05:00:00.000Z"),
        expiresAt: new Date("2026-04-01T04:15:00.000Z"),
        status: HoldStatus.HELD,
        googleCalendarEventId: "replacement-held-event",
      },
    });

    await selectInterviewSlot(replacementHold.token);

    const holds = await prisma.interviewSlotHold.findMany({
      where: { interviewPlanId: interviewPlan.id },
      orderBy: { createdAt: "asc" },
    });
    const interview = await prisma.interview.findUniqueOrThrow({
      where: { applicationId: application.id },
    });

    expect(holds.find((hold) => hold.token === "previous-confirmed")?.status).toBe(
      HoldStatus.RELEASED,
    );
    expect(holds.find((hold) => hold.token === "replacement-held")?.status).toBe(
      HoldStatus.CONFIRMED,
    );
    expect(interview.googleEventId).toBe("new-confirmed-event");
    expect(releaseHoldEventMock).toHaveBeenCalledWith("old-confirmed-event");
  });

  it("keeps the existing interview state when the reschedule alert cannot be delivered", async () => {
    sendInterviewRescheduleAlertMock.mockRejectedValueOnce(new Error("Email provider unavailable"));

    const role = await prisma.role.create({
      data: {
        slug: "reschedule-role",
        title: "AI Product Operator",
        team: "Product",
        location: "Nepal",
        remoteStatus: "Remote",
        experienceLevel: "Senior",
        summary: "Reschedule role",
        responsibilities: ["Ship tools"],
        requirements: ["Write code"],
        status: RoleStatus.OPEN,
      },
    });
    const application = await prisma.application.create({
      data: {
        fullName: "Reschedule Candidate",
        email: "reschedule@example.com",
        linkedinUrl: "https://linkedin.com/in/reschedule",
        status: ApplicationStatus.INTERVIEW_SCHEDULED,
        roleId: role.id,
      },
    });
    const interviewPlan = await prisma.interviewPlan.create({
      data: {
        applicationId: application.id,
        interviewerName: "Jordan Lee",
        interviewerEmail: "jordan@example.com",
        interviewerCalendarId: "demo-calendar",
      },
    });

    await prisma.interviewSlotHold.create({
      data: {
        interviewPlanId: interviewPlan.id,
        token: "reschedule-token",
        startsAt: new Date("2026-04-02T04:15:00.000Z"),
        endsAt: new Date("2026-04-02T05:00:00.000Z"),
        expiresAt: new Date("2026-04-03T04:15:00.000Z"),
        status: HoldStatus.CONFIRMED,
        googleCalendarEventId: "reschedule-event",
      },
    });

    await expect(
      requestInterviewReschedule("reschedule-token", {
        note: "Need a later slot this week.",
      }),
    ).rejects.toThrow(
      "We couldn't send your request to the interviewer right now. Please try again in a few minutes.",
    );

    const refreshedApplication = await prisma.application.findUniqueOrThrow({
      where: { id: application.id },
      include: {
        statusHistory: true,
        interviewPlan: true,
      },
    });

    expect(refreshedApplication.status).toBe(ApplicationStatus.INTERVIEW_SCHEDULED);
    expect(refreshedApplication.interviewPlan?.candidateRequestNote).toBeNull();
    expect(
      refreshedApplication.statusHistory.some((entry) => entry.actorLabel === "Reschedule alert"),
    ).toBe(true);
  });
});
