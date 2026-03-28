import {
  ActorType,
  ApplicationStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";

import { prisma } from "@/lib/prisma/client";
import { conflict } from "@/lib/utils/errors";

const allowedTransitions: Record<ApplicationStatus, ApplicationStatus[]> = {
  APPLIED: ["SCREENED", "REJECTED"],
  SCREENED: ["SHORTLISTED", "REJECTED"],
  SHORTLISTED: ["INTERVIEW_PENDING", "REJECTED"],
  INTERVIEW_PENDING: ["INTERVIEW_SCHEDULED", "REJECTED", "SHORTLISTED"],
  INTERVIEW_SCHEDULED: ["INTERVIEW_COMPLETED", "INTERVIEW_PENDING", "REJECTED"],
  INTERVIEW_COMPLETED: ["OFFER_DRAFT", "REJECTED"],
  OFFER_DRAFT: ["OFFER_SENT", "REJECTED"],
  OFFER_SENT: ["OFFER_SIGNED", "REJECTED"],
  OFFER_SIGNED: ["SLACK_INVITED", "ONBOARDED"],
  SLACK_INVITED: ["ONBOARDED"],
  ONBOARDED: [],
  REJECTED: ["SHORTLISTED"],
};

const manualOverrideStatuses = [
  ApplicationStatus.SCREENED,
  ApplicationStatus.SHORTLISTED,
  ApplicationStatus.REJECTED,
] as const;

type StatusWriter = PrismaClient | Prisma.TransactionClient;

export function canTransitionStatus(from: ApplicationStatus, to: ApplicationStatus) {
  return from === to || allowedTransitions[from].includes(to);
}

export function listAvailableTransitions(from: ApplicationStatus) {
  return allowedTransitions[from];
}

export function listManualOverrideTargets(from: ApplicationStatus) {
  return manualOverrideStatuses.filter(
    (status) => status !== from && canTransitionStatus(from, status),
  );
}

export async function transitionApplicationStatus(input: {
  applicationId: string;
  toStatus: ApplicationStatus;
  actorType: ActorType;
  actorLabel: string;
  note?: string;
  client?: StatusWriter;
}) {
  const client = input.client ?? prisma;
  const application = await client.application.findUniqueOrThrow({
    where: { id: input.applicationId },
    select: {
      status: true,
    },
  });

  if (application.status === input.toStatus) {
    return application.status;
  }

  if (!canTransitionStatus(application.status, input.toStatus)) {
    throw conflict(
      `Invalid status transition from ${application.status} to ${input.toStatus}.`,
      "invalid_status_transition",
    );
  }

  await client.application.update({
    where: { id: input.applicationId },
    data: {
      status: input.toStatus,
    },
  });

  await client.statusHistory.create({
    data: {
      applicationId: input.applicationId,
      fromStatus: application.status,
      toStatus: input.toStatus,
      actorType: input.actorType,
      actorLabel: input.actorLabel,
      note: input.note,
    },
  });

  return input.toStatus;
}

export async function appendStatusNote(input: {
  applicationId: string;
  actorType: ActorType;
  actorLabel: string;
  note: string;
  client?: StatusWriter;
}) {
  const client = input.client ?? prisma;
  const application = await client.application.findUniqueOrThrow({
    where: { id: input.applicationId },
    select: { status: true },
  });

  await client.statusHistory.create({
    data: {
      applicationId: input.applicationId,
      fromStatus: application.status,
      toStatus: application.status,
      actorType: input.actorType,
      actorLabel: input.actorLabel,
      note: input.note,
    },
  });
}
