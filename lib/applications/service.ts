import { randomUUID } from "node:crypto";

import {
  ActorType,
  ApplicationStatus,
  HoldStatus,
  InterviewResponseStatus,
  Prisma,
  RoleStatus,
} from "@prisma/client";
import { addDays, addMinutes, isBefore } from "date-fns";
import { z } from "zod";

import { getAiService } from "@/lib/ai/service";
import { getCalendarService } from "@/lib/calendar/service";
import {
  sendApplicationConfirmation,
  sendInterviewConfirmationEmail,
  sendInterviewRescheduleAlert,
  sendSchedulingNudgeEmail,
  sendSchedulingOptionsEmail,
} from "@/lib/email/service";
import { getTranscriptService } from "@/lib/fireflies/service";
import { generateOfferForApplication } from "@/lib/offers/service";
import { prisma } from "@/lib/prisma/client";
import { buildCandidateResearch } from "@/lib/research/service";
import { extractResumeText } from "@/lib/resume/extract-text";
import {
  appendStatusNote,
  listManualOverrideTargets,
  transitionApplicationStatus,
} from "@/lib/status/transitions";
import { deleteStoredResume, persistResume } from "@/lib/storage/files";
import { env, requireValue } from "@/lib/utils/env";
import { badRequest, conflict, notFound } from "@/lib/utils/errors";

const optionalUrlSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined))
  .pipe(z.string().url().optional());

export const applicationSubmissionSchema = z.object({
  fullName: z.string().trim().min(2),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  linkedinUrl: z.string().trim().url(),
  portfolioUrl: optionalUrlSchema,
  roleId: z.string().trim().min(1),
});

export const manualOverrideSchema = z.object({
  status: z.nativeEnum(ApplicationStatus),
  note: z.string().trim().min(10),
});

export const rescheduleRequestSchema = z.object({
  note: z.string().trim().min(8),
});

export const approvedRescheduleSchema = z.object({
  startsAt: z.coerce.date(),
});

export const feedbackSubmissionSchema = z.object({
  authorName: z.string().trim().min(2),
  authorRole: z.string().trim().optional(),
  content: z.string().trim().min(10),
});

export const offerGenerationSchema = z.object({
  jobTitle: z.string().trim().min(2),
  startDate: z.coerce.date(),
  baseSalary: z.string().trim().min(2),
  compensationNotes: z.string().trim().optional(),
  equityBonus: z.string().trim().optional(),
  reportingManager: z.string().trim().min(2),
  customTerms: z.string().trim().optional(),
  sendNow: z.coerce.boolean().optional(),
});

const applicationListInclude = {
  role: true,
  screeningResult: true,
} satisfies Prisma.ApplicationInclude;

const schedulableStatuses: ApplicationStatus[] = [
  ApplicationStatus.SHORTLISTED,
  ApplicationStatus.INTERVIEW_PENDING,
  ApplicationStatus.INTERVIEW_SCHEDULED,
];

const researchableStatuses: ApplicationStatus[] = [
  ApplicationStatus.SHORTLISTED,
  ApplicationStatus.INTERVIEW_PENDING,
  ApplicationStatus.INTERVIEW_SCHEDULED,
  ApplicationStatus.INTERVIEW_COMPLETED,
  ApplicationStatus.OFFER_DRAFT,
  ApplicationStatus.OFFER_SENT,
  ApplicationStatus.OFFER_SIGNED,
  ApplicationStatus.SLACK_INVITED,
  ApplicationStatus.ONBOARDED,
];

const offerableStatuses: ApplicationStatus[] = [
  ApplicationStatus.INTERVIEW_COMPLETED,
  ApplicationStatus.OFFER_DRAFT,
  ApplicationStatus.OFFER_SENT,
];

type SubmitApplicationResult = {
  applicationId: string;
  confirmationEmailError: string | null;
};

function writeApplicationLog(
  applicationId: string,
  actorLabel: string,
  note: string,
  level: "info" | "error" = "info",
) {
  const message = `[hiring-os] ${new Date().toISOString()} application=${applicationId} step="${actorLabel}" ${note}`;

  if (level === "error") {
    console.error(message);
    return;
  }

  console.info(message);
}

async function recordAutomationActivity(
  applicationId: string,
  actorLabel: string,
  note: string,
  level: "info" | "error" = "info",
) {
  writeApplicationLog(applicationId, actorLabel, note, level);

  await appendStatusNote({
    applicationId,
    actorType: ActorType.SYSTEM,
    actorLabel,
    note,
  });
}

async function recordIntegrationActivity(
  applicationId: string,
  actorLabel: string,
  note: string,
  level: "info" | "error" = "info",
) {
  writeApplicationLog(applicationId, actorLabel, note, level);

  await appendStatusNote({
    applicationId,
    actorType: ActorType.INTEGRATION,
    actorLabel,
    note,
  });
}

function isDuplicateApplicationError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function summarizeConfirmationEmailFailure(message: string) {
  if (message.includes("You can only send testing emails to your own email address")) {
    return [
      "Confirmation email could not be delivered because Resend is still in testing mode",
      `for ${env.resendFromEmail}.`,
      "Verify a sending domain in Resend to email other recipients.",
    ].join(" ");
  }

  return message;
}

function buildConfirmedHoldOverlapWhere(startsAt: Date, endsAt: Date) {
  return {
    status: HoldStatus.CONFIRMED,
    startsAt: {
      lt: endsAt,
    },
    endsAt: {
      gt: startsAt,
    },
  } satisfies Prisma.InterviewSlotHoldWhereInput;
}

function buildReservedHoldWhere(now: Date) {
  return {
    OR: [
      {
        status: HoldStatus.CONFIRMED,
        endsAt: {
          gt: now,
        },
      },
      {
        status: HoldStatus.HELD,
        expiresAt: {
          gt: now,
        },
      },
    ],
  } satisfies Prisma.InterviewSlotHoldWhereInput;
}

export function canSendInterviewOptionsStatus(status: ApplicationStatus) {
  return schedulableStatuses.includes(status);
}

export function canGenerateOfferStatus(status: ApplicationStatus) {
  return offerableStatuses.includes(status);
}

function canBuildResearchStatus(status: ApplicationStatus) {
  return researchableStatuses.includes(status);
}

function getRequiredInterviewerCalendarId() {
  return requireValue("GOOGLE_CALENDAR_ID", env.googleCalendarId);
}

async function notifyConfirmedInterview(input: {
  applicationId: string;
  candidateEmail: string;
  candidateName: string;
  interviewerEmail: string;
  interviewerName: string;
  roleTitle: string;
  startsAt: Date;
  endsAt: Date;
  meetingUrl: string;
  googleEventId?: string | null;
}) {
  try {
    await sendInterviewConfirmationEmail(input);
  } catch (error) {
    await appendStatusNote({
      applicationId: input.applicationId,
      actorType: ActorType.SYSTEM,
      actorLabel: "Scheduling email",
      note: `Interview was confirmed, but the confirmation email failed: ${error instanceof Error ? error.message : "Unknown error."}`,
    });
  }
}

const applicationDetailInclude = {
  role: true,
  resumeAsset: true,
  screeningResult: true,
  researchProfile: true,
  interviewPlan: {
    include: {
      holds: {
        orderBy: {
          startsAt: "asc",
        },
      },
    },
  },
  interview: {
    include: {
      transcript: true,
      feedback: {
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  },
  offer: true,
  statusHistory: {
    orderBy: {
      createdAt: "desc",
    },
  },
  onboardingEvents: {
    orderBy: {
      createdAt: "desc",
    },
  },
  emailLogs: {
    orderBy: {
      createdAt: "desc",
    },
  },
} satisfies Prisma.ApplicationInclude;

export async function getOpenRoles() {
  return prisma.role.findMany({
    where: { status: RoleStatus.OPEN },
    orderBy: {
      createdAt: "asc",
    },
  });
}

export async function listRoles() {
  return prisma.role.findMany({
    orderBy: [{ team: "asc" }, { title: "asc" }],
  });
}

export async function getRoleBySlug(slug: string) {
  return prisma.role.findUnique({
    where: { slug },
  });
}

export async function listAdminApplications(filters: {
  roleId?: string;
  status?: ApplicationStatus;
  startDate?: string;
  endDate?: string;
}) {
  const startDate = filters.startDate ? new Date(filters.startDate) : undefined;
  const endDate = filters.endDate ? addDays(new Date(filters.endDate), 1) : undefined;

  return prisma.application.findMany({
    where: {
      roleId: filters.roleId || undefined,
      status: filters.status || undefined,
      submittedAt:
        startDate || endDate
          ? {
              gte: startDate,
              lt: endDate,
            }
          : undefined,
    },
    include: applicationListInclude,
    orderBy: {
      submittedAt: "desc",
    },
  });
}

export async function getCandidateDetail(applicationId: string) {
  const detail = await prisma.application.findUnique({
    where: { id: applicationId },
    include: applicationDetailInclude,
  });

  if (!detail) {
    throw notFound("Application was not found.", "application_not_found");
  }

  if (!detail.interview?.googleEventId) {
    return detail;
  }

  await syncInterviewAttendance(detail.id);

  const refreshedDetail = await prisma.application.findUnique({
    where: { id: applicationId },
    include: applicationDetailInclude,
  });

  if (!refreshedDetail) {
    throw notFound("Application was not found.", "application_not_found");
  }

  return refreshedDetail;
}

export async function getApplicationResumeAsset(applicationId: string) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: {
      resumeAsset: {
        select: {
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          storagePath: true,
        },
      },
    },
  });

  if (!application) {
    throw notFound("Application was not found.", "application_not_found");
  }

  if (!application.resumeAsset) {
    throw notFound("Resume was not found for this application.", "resume_not_found");
  }

  return application.resumeAsset;
}

export async function submitApplication(formData: FormData): Promise<SubmitApplicationResult> {
  const parsed = applicationSubmissionSchema.parse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    linkedinUrl: formData.get("linkedinUrl"),
    portfolioUrl: formData.get("portfolioUrl"),
    roleId: formData.get("roleId"),
  });

  const resume = formData.get("resume");

  if (!(resume instanceof File) || resume.size === 0) {
    throw badRequest("Please upload a resume.", "resume_required");
  }

  const role = await prisma.role.findUnique({
    where: { id: parsed.roleId },
  });

  if (!role) {
    throw notFound("The selected role no longer exists.", "role_not_found");
  }

  if (role.status !== RoleStatus.OPEN) {
    throw conflict("This role is paused or closed.", "role_unavailable");
  }

  const applicationId = randomUUID();
  let storedResume:
    | {
        storagePath: string;
        bytes: Buffer;
        mimeType: string;
      }
    | undefined;
  let application:
    | (Prisma.ApplicationGetPayload<{
        include: {
          role: true;
        };
      }>)
    | undefined;

  try {
    const persistedResume = await persistResume(resume, applicationId);
    storedResume = persistedResume;
    const extractedText = await extractResumeText(
      resume.name,
      persistedResume.mimeType,
      persistedResume.bytes,
    );

    application = await prisma.$transaction(async (tx) => {
      const created = await tx.application.create({
        data: {
          id: applicationId,
          fullName: parsed.fullName,
          email: parsed.email,
          linkedinUrl: parsed.linkedinUrl,
          portfolioUrl: parsed.portfolioUrl,
          roleId: parsed.roleId,
          resumeAsset: {
            create: {
              originalName: resume.name,
              mimeType: persistedResume.mimeType,
              sizeBytes: resume.size,
              storagePath: persistedResume.storagePath,
              extractedText,
            },
          },
        },
        include: {
          role: true,
        },
      });

      await tx.statusHistory.create({
        data: {
          applicationId,
          toStatus: ApplicationStatus.APPLIED,
          actorType: ActorType.CANDIDATE,
          actorLabel: parsed.fullName,
          note: "Candidate submitted a new application.",
        },
      });

      return created;
    });
  } catch (error) {
    if (storedResume) {
      await deleteStoredResume(storedResume.storagePath);
    }

    if (isDuplicateApplicationError(error)) {
      throw conflict(
        "You have already applied to this role with this email address.",
        "duplicate_application",
      );
    }

    throw error;
  }

  let confirmationEmailError: string | null = null;

  try {
    await sendApplicationConfirmation({
      applicationId,
      candidateName: parsed.fullName,
      toEmail: parsed.email,
      roleTitle: application.role.title,
    });
  } catch (error) {
    const message = summarizeConfirmationEmailFailure(
      error instanceof Error ? error.message : "Unknown confirmation email error.",
    );
    confirmationEmailError = message;
    writeApplicationLog(
      applicationId,
      "Confirmation email",
      `Application confirmation email failed: ${message.replaceAll('"', "'")}`,
      "error",
    );

    await appendStatusNote({
      applicationId,
      actorType: ActorType.SYSTEM,
      actorLabel: "Confirmation email",
      note: `Application confirmation email failed: ${message}`,
    });
  }

  return {
    applicationId,
    confirmationEmailError,
  };
}

export async function runScreeningPipeline(applicationId: string) {
  const application = await prisma.application.findUniqueOrThrow({
    where: { id: applicationId },
    include: {
      role: true,
      resumeAsset: true,
      screeningResult: true,
    },
  });

  if (!application.resumeAsset?.extractedText) {
    throw badRequest("Resume text is missing.", "resume_text_missing");
  }

  if (application.screeningResult) {
    await prisma.application.update({
      where: { id: applicationId },
      data: {
        aiScore: application.screeningResult.score,
      },
    });

    let currentStatus = application.status;

    if (currentStatus === ApplicationStatus.APPLIED) {
      await transitionApplicationStatus({
        applicationId,
        toStatus: ApplicationStatus.SCREENED,
        actorType: ActorType.SYSTEM,
        actorLabel: "AI screening",
        note: application.screeningResult.summary,
      });
      currentStatus = ApplicationStatus.SCREENED;
    }

    if (application.screeningResult.autoShortlisted && currentStatus === ApplicationStatus.SCREENED) {
      await transitionApplicationStatus({
        applicationId,
        toStatus: ApplicationStatus.SHORTLISTED,
        actorType: ActorType.SYSTEM,
        actorLabel: "AI screening",
        note: `Auto-shortlisted at ${application.screeningResult.score}/${application.screeningResult.threshold}.`,
      });
    }

    return {
      applicationId,
      score: application.screeningResult.score,
      shortlisted: application.screeningResult.autoShortlisted,
      summary: application.screeningResult.summary,
    };
  }

  const screeningInput = {
    candidateName: application.fullName,
    roleTitle: application.role.title,
    roleSummary: application.role.summary,
    roleResponsibilities: application.role.responsibilities,
    roleRequirements: application.role.requirements,
    resumeText: application.resumeAsset.extractedText,
    threshold: env.screeningThreshold,
  };
  const ai = getAiService();
  writeApplicationLog(
    applicationId,
    "AI screening",
    `Dispatching screening request resumeChars=${screeningInput.resumeText.length} requirements=${screeningInput.roleRequirements.length}`,
  );
  const screening = await ai.screenResume(screeningInput);
  writeApplicationLog(
    applicationId,
    "AI screening",
    `Received screening result score=${screening.score} parsedSkills=${screening.parsedSkills.length}`,
  );

  await prisma.screeningResult.upsert({
    where: { applicationId },
    update: {
      threshold: env.screeningThreshold,
      score: screening.score,
      summary: screening.summary,
      strengths: screening.strengths,
      gaps: screening.gaps,
      parsedSkills: screening.parsedSkills,
      yearsExperience: screening.yearsExperience ?? undefined,
      education: screening.education ?? Prisma.JsonNull,
      pastEmployers: screening.pastEmployers,
      achievements: screening.achievements,
      autoShortlisted: screening.score >= env.screeningThreshold,
      rawResponse: screening,
    },
    create: {
      applicationId,
      threshold: env.screeningThreshold,
      score: screening.score,
      summary: screening.summary,
      strengths: screening.strengths,
      gaps: screening.gaps,
      parsedSkills: screening.parsedSkills,
      yearsExperience: screening.yearsExperience ?? undefined,
      education: screening.education ?? Prisma.JsonNull,
      pastEmployers: screening.pastEmployers,
      achievements: screening.achievements,
      autoShortlisted: screening.score >= env.screeningThreshold,
      rawResponse: screening,
    },
  });

  await prisma.application.update({
    where: { id: applicationId },
    data: {
      aiScore: screening.score,
    },
  });

  await transitionApplicationStatus({
    applicationId,
    toStatus: ApplicationStatus.SCREENED,
    actorType: ActorType.SYSTEM,
    actorLabel: "AI screening",
    note: screening.summary,
  });

  if (screening.score < env.screeningThreshold) {
    return {
      applicationId,
      score: screening.score,
      shortlisted: false,
      summary: screening.summary,
    };
  }

  await transitionApplicationStatus({
    applicationId,
    toStatus: ApplicationStatus.SHORTLISTED,
    actorType: ActorType.SYSTEM,
    actorLabel: "AI screening",
      note: `Auto-shortlisted at ${screening.score}/${env.screeningThreshold}.`,
  });

  return {
    applicationId,
    score: screening.score,
    shortlisted: true,
    summary: screening.summary,
  };
}

export async function runCandidateResearch(applicationId: string) {
  const application = await prisma.application.findUniqueOrThrow({
    where: { id: applicationId },
    include: {
      role: true,
      screeningResult: true,
      researchProfile: true,
    },
  });

  if (
    !application.screeningResult?.autoShortlisted ||
    !canBuildResearchStatus(application.status)
  ) {
    return null;
  }

  if (application.researchProfile) {
    return application.researchProfile;
  }

  writeApplicationLog(
    applicationId,
    "Candidate research",
    `Dispatching research request resumeSummaryChars=${application.screeningResult.summary.length} hasPortfolio=${Boolean(application.portfolioUrl)}`,
  );

  const research = await buildCandidateResearch({
    fullName: application.fullName,
    roleTitle: application.role.title,
    linkedinUrl: application.linkedinUrl,
    portfolioUrl: application.portfolioUrl,
    resumeSummary: application.screeningResult.summary,
  });
  writeApplicationLog(
    applicationId,
    "Candidate research",
    `Received research result sources=${research.sources.length} discrepancies=${research.discrepancies.length}`,
  );

  await prisma.researchProfile.upsert({
    where: { applicationId },
    update: {
      brief: research.brief,
      linkedinSummary: research.linkedinSummary,
      xSummary: research.xSummary,
      githubSummary: research.githubSummary,
      portfolioSummary: research.portfolioSummary,
      discrepancies: research.discrepancies,
      limitations: research.limitations,
      sources: research.sources,
    },
    create: {
      applicationId,
      brief: research.brief,
      linkedinSummary: research.linkedinSummary,
      xSummary: research.xSummary,
      githubSummary: research.githubSummary,
      portfolioSummary: research.portfolioSummary,
      discrepancies: research.discrepancies,
      limitations: research.limitations,
      sources: research.sources,
    },
  });

  return prisma.researchProfile.findUnique({
    where: { applicationId },
  });
}

async function autoSendInterviewOptions(applicationId: string) {
  const application = await prisma.application.findUniqueOrThrow({
    where: { id: applicationId },
    include: {
      interview: true,
      interviewPlan: {
        include: {
          holds: true,
        },
      },
    },
  });
  const now = new Date();
  const hasActiveHolds = application.interviewPlan?.holds.some(
    (hold) =>
      hold.status === HoldStatus.CONFIRMED ||
      (hold.status === HoldStatus.HELD && hold.expiresAt > now),
  );

  if (
    application.status !== ApplicationStatus.SHORTLISTED ||
    application.interview ||
    hasActiveHolds
  ) {
    return null;
  }

  return sendInterviewOptions(applicationId);
}

export async function resumePendingInterviewScheduling() {
  const applications = await prisma.application.findMany({
    where: {
      status: ApplicationStatus.SHORTLISTED,
    },
    select: {
      id: true,
    },
    orderBy: {
      submittedAt: "asc",
    },
  });

  let resumedCount = 0;

  for (const application of applications) {
    await recordAutomationActivity(
      application.id,
      "Scheduling automation",
      "Scheduling resumed after Google Calendar was connected.",
    );

    try {
      const holds = await autoSendInterviewOptions(application.id);

      await recordAutomationActivity(
        application.id,
        "Scheduling automation",
        holds
          ? `Scheduling completed with ${holds.length} interview options.`
          : "Scheduling was skipped because interview options already exist or the candidate is not ready.",
      );

      if (holds) {
        resumedCount += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown scheduling error.";

      await recordAutomationActivity(
        application.id,
        "Scheduling automation",
        `Scheduling failed: ${message}`,
        "error",
      );
    }
  }

  return {
    resumedCount,
  };
}

export async function runApplicationAutomation(applicationId: string) {
  await recordAutomationActivity(
    applicationId,
    "Automation",
    "Application automation started.",
  );

  let screeningResult:
    | {
        applicationId: string;
        score: number;
        shortlisted: boolean;
        summary: string;
      }
    | null = null;

  await recordAutomationActivity(applicationId, "AI screening", "Screening started.");

  try {
    screeningResult = await runScreeningPipeline(applicationId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown screening error.";

    await recordAutomationActivity(
      applicationId,
      "AI screening",
      `Screening failed: ${message}`,
      "error",
    );
    await recordAutomationActivity(
      applicationId,
      "Automation",
      "Application automation stopped during screening.",
    );

    return null;
  }

  await recordAutomationActivity(
    applicationId,
    "AI screening",
    `Screening completed with a score of ${screeningResult.score}/100.`,
  );

  if (!screeningResult.shortlisted) {
    await recordAutomationActivity(
      applicationId,
      "Automation",
      "Application automation completed after screening.",
    );

    return screeningResult;
  }

  await recordAutomationActivity(
    applicationId,
    "Candidate research",
    "Research started.",
  );

  try {
    const researchProfile = await runCandidateResearch(applicationId);

    await recordAutomationActivity(
      applicationId,
      "Candidate research",
      researchProfile
        ? "Research completed and the candidate brief was saved."
        : "Research was skipped because the candidate is not eligible yet.",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown research error.";

    await recordAutomationActivity(
      applicationId,
      "Candidate research",
      `Research failed: ${message}`,
      "error",
    );
  }

  await recordAutomationActivity(
    applicationId,
    "Scheduling automation",
    "Scheduling started.",
  );

  try {
    const holds = await autoSendInterviewOptions(applicationId);

    await recordAutomationActivity(
      applicationId,
      "Scheduling automation",
      holds
        ? `Scheduling completed with ${holds.length} interview options.`
        : "Scheduling was skipped because interview options already exist or the candidate is not ready.",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scheduling error.";

    await recordAutomationActivity(
      applicationId,
      "Scheduling automation",
      `Scheduling failed: ${message}`,
      "error",
    );
  }

  await recordAutomationActivity(
    applicationId,
    "Automation",
    "Application automation completed.",
  );

  return screeningResult;
}

export async function overrideApplicationDecision(
  applicationId: string,
  input: z.infer<typeof manualOverrideSchema>,
) {
  const parsed = manualOverrideSchema.parse(input);
  const application = await prisma.application.findUniqueOrThrow({
    where: { id: applicationId },
    select: {
      status: true,
    },
  });
  const allowedTargets = listManualOverrideTargets(application.status);

  if (!allowedTargets.some((status) => status === parsed.status)) {
    throw conflict(
      "This override is not valid for the candidate's current status.",
      "invalid_override_target",
    );
  }

  await transitionApplicationStatus({
    applicationId,
    toStatus: parsed.status,
    actorType: ActorType.ADMIN,
    actorLabel: "Admin override",
    note: parsed.note,
  });

  return getCandidateDetail(applicationId);
}

export async function sendInterviewOptions(applicationId: string) {
  const application = await prisma.application.findUniqueOrThrow({
    where: { id: applicationId },
    include: {
      role: true,
      interviewPlan: {
        include: {
          holds: true,
        },
      },
    },
  });

  if (!canSendInterviewOptionsStatus(application.status)) {
    throw conflict(
      "This candidate is not ready for interview scheduling.",
      "candidate_not_schedulable",
    );
  }

  const calendar = getCalendarService();
  await calendar.assertInterviewSchedulingReady();

  const interviewPlan =
    application.interviewPlan ??
    (await prisma.interviewPlan.create({
      data: {
        applicationId,
        interviewerName: env.interviewerName,
        interviewerEmail: env.interviewerEmail,
        interviewerCalendarId: getRequiredInterviewerCalendarId(),
      },
    }));

  await prisma.interviewSlotHold.updateMany({
    where: {
      interviewPlanId: interviewPlan.id,
      status: HoldStatus.HELD,
      expiresAt: {
        lt: new Date(),
      },
    },
    data: {
      status: HoldStatus.EXPIRED,
    },
  });

  const now = new Date();
  const reservedHolds = await prisma.interviewSlotHold.findMany({
    where: {
      ...buildReservedHoldWhere(now),
    },
    select: {
      startsAt: true,
      endsAt: true,
    },
  });

  const slots = await calendar.findAvailableSlots({
    reserved: reservedHolds,
    count: 3,
  });

  if (slots.length === 0) {
    throw conflict(
      "No interview slots were available in the next 5 business days.",
      "no_interview_slots",
    );
  }

  const existingHeld = await prisma.interviewSlotHold.findMany({
    where: {
      interviewPlanId: interviewPlan.id,
      status: HoldStatus.HELD,
    },
  });
  const holdDrafts = [] as Array<{
    token: string;
    startsAt: Date;
    endsAt: Date;
    expiresAt: Date;
    googleCalendarEventId: string;
  }>;

  try {
    for (const slot of slots) {
      const holdId = randomUUID();
      const event = await calendar.createHoldEvent({
        holdId,
        applicationId,
        candidateName: application.fullName,
        roleTitle: application.role.title,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
      });

      holdDrafts.push({
        token: randomUUID(),
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        expiresAt: addDays(now, 2),
        googleCalendarEventId: event.eventId,
      });
    }
  } catch (error) {
    for (const draft of holdDrafts) {
      await calendar.releaseHoldEvent(draft.googleCalendarEventId).catch(() => undefined);
    }

    throw error;
  }

  let createdHolds: Prisma.InterviewSlotHoldGetPayload<Record<string, never>>[] = [];

  try {
    const transactionResult = await prisma.$transaction(async (tx) => {
      if (existingHeld.length > 0) {
        await tx.interviewSlotHold.updateMany({
          where: {
            interviewPlanId: interviewPlan.id,
            status: HoldStatus.HELD,
          },
          data: {
            status: HoldStatus.RELEASED,
          },
        });
      }

      const holds = [] as Prisma.InterviewSlotHoldGetPayload<Record<string, never>>[];

      for (const draft of holdDrafts) {
        holds.push(
          await tx.interviewSlotHold.create({
            data: {
              interviewPlanId: interviewPlan.id,
              token: draft.token,
              startsAt: draft.startsAt,
              endsAt: draft.endsAt,
              expiresAt: draft.expiresAt,
              googleCalendarEventId: draft.googleCalendarEventId,
            },
          }),
        );
      }

      await tx.interviewPlan.update({
        where: { id: interviewPlan.id },
        data: {
          lastOptionsSentAt: new Date(),
          candidateRequestNote: null,
        },
      });

      await transitionApplicationStatus({
        applicationId,
        toStatus: ApplicationStatus.INTERVIEW_PENDING,
        actorType: ActorType.ADMIN,
        actorLabel: "Scheduling",
        note: "Interview options sent to candidate.",
        client: tx,
      });

      return holds;
    });

    createdHolds = transactionResult;
  } catch (error) {
    for (const draft of holdDrafts) {
      await calendar.releaseHoldEvent(draft.googleCalendarEventId).catch(() => undefined);
    }

    throw error;
  }

  for (const hold of existingHeld) {
    if (hold.googleCalendarEventId) {
      await calendar.releaseHoldEvent(hold.googleCalendarEventId).catch(() => undefined);
    }
  }

  try {
    await sendSchedulingOptionsEmail({
      applicationId,
      candidateName: application.fullName,
      toEmail: application.email,
      roleTitle: application.role.title,
      options: createdHolds.map((hold) => ({
        startsAt: hold.startsAt,
        url: `${env.appUrl}/candidates/schedule/${hold.token}`,
      })),
    });
  } catch (error) {
    await appendStatusNote({
      applicationId,
      actorType: ActorType.SYSTEM,
      actorLabel: "Scheduling email",
      note: `Interview options were created, but the scheduling email failed: ${error instanceof Error ? error.message : "Unknown error."}`,
    });
  }

  return createdHolds;
}

export async function selectInterviewSlot(token: string) {
  const calendar = getCalendarService();
  await calendar.assertInterviewSchedulingReady();

  const result = await prisma.$transaction(
    async (tx) => {
      const hold = await tx.interviewSlotHold.findUniqueOrThrow({
        where: { token },
        include: {
          interviewPlan: {
            include: {
              application: {
                include: {
                  role: true,
                },
              },
              holds: true,
            },
          },
        },
      });
      const now = new Date();

      if (hold.status !== HoldStatus.HELD || isBefore(hold.expiresAt, now)) {
        throw notFound("This interview slot is no longer available.", "slot_unavailable");
      }

      const existingInterview = await tx.interview.findUnique({
        where: {
          applicationId: hold.interviewPlan.applicationId,
        },
      });
      const previousConfirmedHold = await tx.interviewSlotHold.findFirst({
        where: {
          interviewPlanId: hold.interviewPlanId,
          id: {
            not: hold.id,
          },
          status: HoldStatus.CONFIRMED,
        },
      });
      const conflictingHold = await tx.interviewSlotHold.findFirst({
        where: {
          id: {
            not: hold.id,
          },
          interviewPlanId: {
            not: hold.interviewPlanId,
          },
          ...buildConfirmedHoldOverlapWhere(hold.startsAt, hold.endsAt),
        },
      });

      if (conflictingHold) {
        throw conflict(
          "Another candidate already confirmed this slot.",
          "slot_conflict",
        );
      }

      await tx.interviewSlotHold.update({
        where: { id: hold.id },
        data: {
          status: HoldStatus.CONFIRMED,
        },
      });

      await tx.interviewSlotHold.updateMany({
        where: {
          interviewPlanId: hold.interviewPlanId,
          id: {
            not: hold.id,
          },
          status: HoldStatus.HELD,
        },
        data: {
          status: HoldStatus.RELEASED,
        },
      });

      if (previousConfirmedHold) {
        await tx.interviewSlotHold.update({
          where: { id: previousConfirmedHold.id },
          data: {
            status: HoldStatus.RELEASED,
          },
        });
      }

      await tx.interview.upsert({
        where: {
          applicationId: hold.interviewPlan.applicationId,
        },
        update: {
          startsAt: hold.startsAt,
          endsAt: hold.endsAt,
        },
        create: {
          applicationId: hold.interviewPlan.applicationId,
          interviewPlanId: hold.interviewPlanId,
          startsAt: hold.startsAt,
          endsAt: hold.endsAt,
        },
      });

      await tx.interviewPlan.update({
        where: { id: hold.interviewPlanId },
        data: {
          candidateRequestNote: null,
        },
      });

      await transitionApplicationStatus({
        applicationId: hold.interviewPlan.applicationId,
        toStatus: ApplicationStatus.INTERVIEW_SCHEDULED,
        actorType: ActorType.CANDIDATE,
        actorLabel: hold.interviewPlan.application.fullName,
        note: `Candidate selected ${hold.startsAt.toISOString()}.`,
        client: tx,
      });

      return {
        applicationId: hold.interviewPlan.applicationId,
        candidateName: hold.interviewPlan.application.fullName,
        candidateEmail: hold.interviewPlan.application.email,
        interviewerName: hold.interviewPlan.interviewerName,
        interviewerEmail: hold.interviewPlan.interviewerEmail,
        roleTitle: hold.interviewPlan.application.role.title,
        selectedHold: hold,
        releasedCalendarEventIds: hold.interviewPlan.holds
          .filter(
            (candidateHold) =>
              candidateHold.id !== hold.id && Boolean(candidateHold.googleCalendarEventId),
          )
          .map((candidateHold) => candidateHold.googleCalendarEventId!)
          .concat(
            previousConfirmedHold?.googleCalendarEventId
              ? [previousConfirmedHold.googleCalendarEventId]
              : [],
          ),
        previousInterviewEventId: existingInterview?.googleEventId ?? null,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );

  const confirmation = await calendar.confirmHoldEvent({
    eventId: result.selectedHold.googleCalendarEventId ?? result.selectedHold.id,
    candidateName: result.candidateName,
    candidateEmail: result.candidateEmail,
    roleTitle: result.roleTitle,
    startsAt: result.selectedHold.startsAt,
    endsAt: result.selectedHold.endsAt,
  });

  const eventIdsToRelease = [
    ...new Set(
      [
        ...result.releasedCalendarEventIds,
        result.previousInterviewEventId,
      ].filter(
        (eventId): eventId is string =>
          Boolean(eventId) && eventId !== confirmation.eventId,
      ),
    ),
  ];

  for (const eventId of eventIdsToRelease) {
    await calendar.releaseHoldEvent(eventId);
  }

  await prisma.interview.update({
    where: {
      applicationId: result.applicationId,
    },
    data: {
      googleEventId: confirmation.eventId,
      meetingUrl: confirmation.meetingUrl,
    },
  });

  await notifyConfirmedInterview({
    applicationId: result.applicationId,
    candidateEmail: result.candidateEmail,
    candidateName: result.candidateName,
    interviewerEmail: result.interviewerEmail,
    interviewerName: result.interviewerName,
    roleTitle: result.roleTitle,
    startsAt: result.selectedHold.startsAt,
    endsAt: result.selectedHold.endsAt,
    meetingUrl: confirmation.meetingUrl,
    googleEventId: confirmation.eventId,
  });

  return getCandidateDetail(result.applicationId);
}

export async function requestInterviewReschedule(token: string, input: z.infer<typeof rescheduleRequestSchema>) {
  const parsed = rescheduleRequestSchema.parse(input);
  const hold = await prisma.interviewSlotHold.findUniqueOrThrow({
    where: { token },
    include: {
      interviewPlan: {
        include: {
          application: true,
        },
      },
    },
  });

  if (hold.status !== HoldStatus.HELD && hold.status !== HoldStatus.CONFIRMED) {
    throw notFound("This scheduling link is no longer active.", "schedule_link_inactive");
  }

  try {
    await sendInterviewRescheduleAlert({
      applicationId: hold.interviewPlan.applicationId,
      candidateName: hold.interviewPlan.application.fullName,
      candidateEmail: hold.interviewPlan.application.email,
      interviewerEmail: hold.interviewPlan.interviewerEmail,
      note: parsed.note,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";

    await appendStatusNote({
      applicationId: hold.interviewPlan.applicationId,
      actorType: ActorType.SYSTEM,
      actorLabel: "Reschedule alert",
      note: `Candidate requested a new time, but the interviewer alert email failed: ${message}`,
    });

    throw badRequest(
      "We couldn't send your request to the interviewer right now. Please try again in a few minutes.",
      "reschedule_alert_failed",
    );
  }

  await prisma.interviewPlan.update({
    where: { id: hold.interviewPlanId },
    data: {
      candidateRequestNote: parsed.note,
    },
  });

  await transitionApplicationStatus({
    applicationId: hold.interviewPlan.applicationId,
    toStatus: ApplicationStatus.INTERVIEW_PENDING,
    actorType: ActorType.CANDIDATE,
    actorLabel: hold.interviewPlan.application.fullName,
    note: `Candidate requested a different time: ${parsed.note}`,
  });

  return hold.interviewPlan.applicationId;
}

export async function scheduleApprovedInterviewTime(
  applicationId: string,
  input: z.infer<typeof approvedRescheduleSchema>,
) {
  const parsed = approvedRescheduleSchema.parse(input);

  if (isBefore(parsed.startsAt, new Date())) {
    throw badRequest(
      "Approved interview times must be in the future.",
      "approved_time_in_past",
    );
  }

  const application = await prisma.application.findUniqueOrThrow({
    where: { id: applicationId },
    include: {
      role: true,
      interview: true,
      interviewPlan: {
        include: {
          holds: true,
        },
      },
    },
  });

  if (!canSendInterviewOptionsStatus(application.status)) {
    throw conflict(
      "This candidate is not ready for interview scheduling.",
      "candidate_not_schedulable",
    );
  }

  const calendar = getCalendarService();
  await calendar.assertInterviewSchedulingReady();

  const interviewPlan =
    application.interviewPlan ??
    (await prisma.interviewPlan.create({
      data: {
        applicationId,
        interviewerName: env.interviewerName,
        interviewerEmail: env.interviewerEmail,
        interviewerCalendarId: getRequiredInterviewerCalendarId(),
      },
    }));
  const startsAt = parsed.startsAt;
  const endsAt = addMinutes(startsAt, 45);
  const holdId = randomUUID();
  const newCalendarHold = await calendar.createHoldEvent({
    holdId,
    applicationId,
    candidateName: application.fullName,
    roleTitle: application.role.title,
    startsAt,
    endsAt,
  });

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const conflictingHold = await tx.interviewSlotHold.findFirst({
          where: {
            interviewPlanId: {
              not: interviewPlan.id,
            },
            OR: [
              buildConfirmedHoldOverlapWhere(startsAt, endsAt),
              {
                status: HoldStatus.HELD,
                expiresAt: {
                  gt: new Date(),
                },
                startsAt: {
                  lt: endsAt,
                },
                endsAt: {
                  gt: startsAt,
                },
              },
            ],
          },
        });

        if (conflictingHold) {
          throw conflict(
            "Another candidate already has this slot reserved.",
            "slot_reserved",
          );
        }

        const existingInterview = await tx.interview.findUnique({
          where: {
            applicationId,
          },
        });
        const releasableHolds = await tx.interviewSlotHold.findMany({
          where: {
            interviewPlanId: interviewPlan.id,
            status: {
              in: [HoldStatus.HELD, HoldStatus.CONFIRMED],
            },
          },
        });
        const confirmedHold = await tx.interviewSlotHold.create({
          data: {
            interviewPlanId: interviewPlan.id,
            token: randomUUID(),
            startsAt,
            endsAt,
            expiresAt: addDays(new Date(), 2),
            status: HoldStatus.CONFIRMED,
            googleCalendarEventId: newCalendarHold.eventId,
          },
        });

        await tx.interviewSlotHold.updateMany({
          where: {
            interviewPlanId: interviewPlan.id,
            id: {
              not: confirmedHold.id,
            },
            status: {
              in: [HoldStatus.HELD, HoldStatus.CONFIRMED],
            },
          },
          data: {
            status: HoldStatus.RELEASED,
          },
        });

        await tx.interview.upsert({
          where: {
            applicationId,
          },
          update: {
            startsAt,
            endsAt,
          },
          create: {
            applicationId,
            interviewPlanId: interviewPlan.id,
            startsAt,
            endsAt,
          },
        });

        await tx.interviewPlan.update({
          where: { id: interviewPlan.id },
          data: {
            candidateRequestNote: null,
          },
        });

        await transitionApplicationStatus({
          applicationId,
          toStatus: ApplicationStatus.INTERVIEW_SCHEDULED,
          actorType: ActorType.ADMIN,
          actorLabel: "Scheduling",
          note: `Interviewer approved ${startsAt.toISOString()} directly.`,
          client: tx,
        });

        return {
          confirmedHold,
          releasedCalendarEventIds: releasableHolds
            .map((holdItem) => holdItem.googleCalendarEventId)
            .filter((eventId): eventId is string => Boolean(eventId)),
          previousInterviewEventId: existingInterview?.googleEventId ?? null,
          interviewerEmail: interviewPlan.interviewerEmail,
          interviewerName: interviewPlan.interviewerName,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    const confirmation = await calendar.confirmHoldEvent({
      eventId: result.confirmedHold.googleCalendarEventId ?? result.confirmedHold.id,
      candidateName: application.fullName,
      candidateEmail: application.email,
      roleTitle: application.role.title,
      startsAt,
      endsAt,
    });
    const eventIdsToRelease = [
      ...new Set(
        [...result.releasedCalendarEventIds, result.previousInterviewEventId].filter(
          (eventId): eventId is string =>
            Boolean(eventId) && eventId !== confirmation.eventId,
        ),
      ),
    ];

    for (const eventId of eventIdsToRelease) {
      await calendar.releaseHoldEvent(eventId);
    }

    await prisma.interview.update({
      where: {
        applicationId,
      },
      data: {
        googleEventId: confirmation.eventId,
        meetingUrl: confirmation.meetingUrl,
      },
    });

    await notifyConfirmedInterview({
      applicationId,
      candidateEmail: application.email,
      candidateName: application.fullName,
      interviewerEmail: result.interviewerEmail,
      interviewerName: result.interviewerName,
      roleTitle: application.role.title,
      startsAt,
      endsAt,
      meetingUrl: confirmation.meetingUrl,
      googleEventId: confirmation.eventId,
    });
  } catch (error) {
    await calendar.releaseHoldEvent(newCalendarHold.eventId).catch(() => undefined);
    throw error;
  }

  return getCandidateDetail(applicationId);
}

export async function processInterviewSchedulingNudges(now = new Date()) {
  const staleThreshold = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const interviewPlans = await prisma.interviewPlan.findMany({
    where: {
      lastOptionsSentAt: {
        lte: staleThreshold,
      },
      holds: {
        some: {
          status: HoldStatus.HELD,
          expiresAt: {
            gt: now,
          },
        },
      },
    },
    include: {
      application: {
        include: {
          role: true,
        },
      },
      holds: {
        where: {
          status: HoldStatus.HELD,
          expiresAt: {
            gt: now,
          },
        },
        orderBy: {
          startsAt: "asc",
        },
      },
    },
  });

  const nudgedApplicationIds: string[] = [];

  for (const interviewPlan of interviewPlans) {
    if (!interviewPlan.lastOptionsSentAt) {
      continue;
    }

    if (
      interviewPlan.lastNudgeAt &&
      interviewPlan.lastNudgeAt >= interviewPlan.lastOptionsSentAt
    ) {
      continue;
    }

    if (interviewPlan.holds.length === 0) {
      continue;
    }

    try {
      await sendSchedulingNudgeEmail({
        applicationId: interviewPlan.applicationId,
        candidateName: interviewPlan.application.fullName,
        toEmail: interviewPlan.application.email,
        roleTitle: interviewPlan.application.role.title,
        options: interviewPlan.holds.map((hold) => ({
          startsAt: hold.startsAt,
          url: `${env.appUrl}/candidates/schedule/${hold.token}`,
        })),
      });
    } catch (error) {
      await appendStatusNote({
        applicationId: interviewPlan.applicationId,
        actorType: ActorType.SYSTEM,
        actorLabel: "Scheduling nudge",
        note: `Skipped overdue nudge because the email failed: ${error instanceof Error ? error.message : "Unknown error."}`,
      });
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await tx.interviewPlan.update({
        where: { id: interviewPlan.id },
        data: {
          lastNudgeAt: now,
        },
      });

      await appendStatusNote({
        applicationId: interviewPlan.applicationId,
        actorType: ActorType.SYSTEM,
        actorLabel: "Scheduling nudge",
        note: "Sent a 48-hour interview scheduling follow-up for active held slots.",
        client: tx,
      });
    });

    nudgedApplicationIds.push(interviewPlan.applicationId);
  }

  return {
    nudgedApplicationIds,
    nudgedCount: nudgedApplicationIds.length,
  };
}

export async function syncInterviewAttendance(applicationId: string) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: {
      interview: true,
    },
  });

  if (!application?.interview?.googleEventId) {
    return null;
  }

  const calendar = getCalendarService();
  const response = await calendar.getAttendeeResponseStatus({
    eventId: application.interview.googleEventId,
    candidateEmail: application.email,
  });

  const mappedStatus =
    response === "ACCEPTED"
      ? InterviewResponseStatus.ACCEPTED
      : response === "DECLINED"
        ? InterviewResponseStatus.DECLINED
        : InterviewResponseStatus.NEEDS_ACTION;

  if (mappedStatus !== application.interview.attendeeResponseStatus) {
    await prisma.interview.update({
      where: { id: application.interview.id },
      data: {
        attendeeResponseStatus: mappedStatus,
      },
    });

    await appendStatusNote({
      applicationId,
      actorType: ActorType.INTEGRATION,
      actorLabel: "Google Calendar",
      note: `Candidate calendar response is now ${response.toLowerCase().replace("_", " ")}.`,
    });
  }

  return mappedStatus;
}

export async function startInterviewNotetaker(applicationId: string) {
  const application = await prisma.application.findUniqueOrThrow({
    where: { id: applicationId },
    include: {
      role: true,
      interview: true,
      interviewPlan: true,
    },
  });

  if (!application.interview?.meetingUrl) {
    throw conflict(
      "Interview must be confirmed before Fireflies can join.",
      "interview_not_ready_for_notetaker",
    );
  }

  writeApplicationLog(applicationId, "Fireflies", "Requesting live meeting capture.");

  try {
    const transcriptService = getTranscriptService();
    const capture = await transcriptService.startLiveMeetingCapture({
      attendees: [
        {
          email: application.email,
          displayName: application.fullName,
        },
        {
          email: application.interviewPlan?.interviewerEmail || env.interviewerEmail,
          displayName: application.interviewPlan?.interviewerName || env.interviewerName,
        },
      ],
      durationMinutes: Math.max(
        15,
        Math.round(
          (application.interview.endsAt.getTime() - application.interview.startsAt.getTime()) /
            60_000,
        ),
      ),
      meetingLink: application.interview.meetingUrl,
      title: `${application.role.title} interview with ${application.fullName}`,
    });

    await prisma.interview.update({
      where: { id: application.interview.id },
      data: {
        notetakerProvider: "fireflies",
        notetakerMeetingId: capture.providerMeetingId,
        notetakerState: capture.state ?? "REQUESTED",
        notetakerRequestedAt: capture.requestedAt,
      },
    });

    const statusNote = [
      capture.message.trim(),
      capture.providerMeetingId ? `Meeting ID: ${capture.providerMeetingId}.` : null,
      capture.state ? `State: ${capture.state}.` : null,
      "If the call finishes before Fireflies syncs, paste transcript or interview notes below to continue.",
    ]
      .filter(Boolean)
      .join(" ");

    await recordIntegrationActivity(applicationId, "Fireflies", statusNote);

    return {
      application: await getCandidateDetail(applicationId),
      message: statusNote,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start Fireflies.";
    await recordIntegrationActivity(applicationId, "Fireflies", `Start failed: ${message}`, "error");
    throw error;
  }
}

export async function syncInterviewNotetakerStatus(applicationId: string) {
  const application = await prisma.application.findUniqueOrThrow({
    where: { id: applicationId },
    include: {
      interview: true,
    },
  });

  if (!application.interview?.meetingUrl) {
    throw conflict(
      "Interview must be confirmed before Fireflies status can be checked.",
      "interview_not_ready_for_notetaker",
    );
  }

  writeApplicationLog(applicationId, "Fireflies", "Checking live meeting status.");

  try {
    const transcriptService = getTranscriptService();
    const liveMeeting = await transcriptService.findLiveMeetingByLink({
      meetingLink: application.interview.meetingUrl,
    });

    if (liveMeeting) {
      await prisma.interview.update({
        where: { id: application.interview.id },
        data: {
          notetakerProvider: "fireflies",
          notetakerMeetingId: liveMeeting.providerMeetingId,
          notetakerState: liveMeeting.state ?? "ACTIVE",
        },
      });

      const message = `Fireflies state: ${liveMeeting.state ?? "UNKNOWN"}${liveMeeting.providerMeetingId ? ` · Meeting ID: ${liveMeeting.providerMeetingId}` : ""}`;

      if (
        application.interview.notetakerMeetingId !== liveMeeting.providerMeetingId ||
        application.interview.notetakerState !== (liveMeeting.state ?? "ACTIVE")
      ) {
        await recordIntegrationActivity(applicationId, "Fireflies", message);
      } else {
        writeApplicationLog(applicationId, "Fireflies", message);
      }

      return {
        application: await getCandidateDetail(applicationId),
        message,
      };
    }

    const message = application.interview.notetakerMeetingId
      ? `Fireflies is not currently reporting this meeting as live. Stored meeting ID: ${application.interview.notetakerMeetingId}. If the interview already happened, fetch the transcript below or paste notes manually.`
      : "Fireflies has not joined this meeting yet. If the interview already happened, paste transcript or interview notes below to continue.";

    writeApplicationLog(applicationId, "Fireflies", message);

    return {
      application: await getCandidateDetail(applicationId),
      message,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sync Fireflies status.";
    await recordIntegrationActivity(applicationId, "Fireflies", `Status check failed: ${message}`, "error");
    throw error;
  }
}

export async function ingestTranscriptFromWebhook(input: {
  applicationId: string;
  providerMeetingId?: string;
  directText?: string;
}) {
  const application = await prisma.application.findUniqueOrThrow({
    where: { id: input.applicationId },
    include: {
      role: true,
      interview: true,
    },
  });

  if (!application.interview) {
    throw conflict(
      "Interview is not scheduled for this application.",
      "interview_not_scheduled",
    );
  }

  const providerMeetingId =
    input.providerMeetingId?.trim() || application.interview.notetakerMeetingId || undefined;
  const directText = input.directText?.trim() || undefined;

  if (!providerMeetingId && !directText) {
    throw badRequest(
      "No Fireflies meeting ID is stored yet. Start or sync Fireflies first, or paste transcript text directly.",
      "missing_transcript_source",
    );
  }

  writeApplicationLog(
    application.id,
    "Transcript",
    directText
      ? `Storing pasted transcript text chars=${directText.length}.`
      : `Fetching transcript from Fireflies meetingId=${providerMeetingId}.`,
  );

  try {
    const transcriptService = getTranscriptService();
    const transcriptPayload = await transcriptService.retrieveTranscript({
      providerMeetingId,
      directText,
      candidateName: application.fullName,
      roleTitle: application.role.title,
    });
    const transcriptText = transcriptPayload.fullText.trim()
      ? transcriptPayload.fullText
      : [transcriptPayload.summary, ...transcriptPayload.bulletPoints].join("\n");
    const ai = getAiService();
    const transcriptSummary = await ai.summarizeTranscript({
      candidateName: application.fullName,
      roleTitle: application.role.title,
      transcriptText,
    });

    await prisma.transcript.upsert({
      where: {
        interviewId: application.interview.id,
      },
      update: {
        provider: transcriptPayload.provider,
        providerMeetingId: transcriptPayload.providerMeetingId,
        summary: transcriptSummary.summary,
        bulletPoints: transcriptSummary.bulletPoints,
        fullText: transcriptText,
        retrievedAt: transcriptPayload.retrievedAt,
      },
      create: {
        interviewId: application.interview.id,
        provider: transcriptPayload.provider,
        providerMeetingId: transcriptPayload.providerMeetingId,
        summary: transcriptSummary.summary,
        bulletPoints: transcriptSummary.bulletPoints,
        fullText: transcriptText,
        retrievedAt: transcriptPayload.retrievedAt,
      },
    });

    await prisma.interview.update({
      where: { id: application.interview.id },
      data: {
        notetakerProvider: transcriptPayload.provider === "direct-input" ? "manual" : "fireflies",
        notetakerMeetingId: transcriptPayload.providerMeetingId ?? providerMeetingId,
        notetakerState: "TRANSCRIPT_STORED",
      },
    });

    const shouldAdvanceToInterviewCompleted =
      application.status === ApplicationStatus.INTERVIEW_PENDING ||
      application.status === ApplicationStatus.INTERVIEW_SCHEDULED;

    const actorLabel = transcriptPayload.provider === "direct-input" ? "Transcript import" : "Fireflies";
    const statusNote =
      transcriptPayload.provider === "direct-input"
        ? "Transcript stored from pasted interview notes."
        : "Transcript stored after Fireflies retrieval.";

    if (shouldAdvanceToInterviewCompleted) {
      await transitionApplicationStatus({
        applicationId: application.id,
        toStatus: ApplicationStatus.INTERVIEW_COMPLETED,
        actorType: ActorType.INTEGRATION,
        actorLabel,
        note: `${statusNote} Interview moved to completed.`,
      });
    } else {
      await recordIntegrationActivity(application.id, actorLabel, statusNote);
    }

    const message = shouldAdvanceToInterviewCompleted
      ? "Transcript stored and interview moved to completed."
      : "Transcript stored successfully.";

    return {
      application: await getCandidateDetail(application.id),
      message,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to ingest transcript.";
    await recordIntegrationActivity(application.id, "Transcript", `Import failed: ${message}`, "error");
    throw error;
  }
}

export async function submitInterviewFeedback(
  applicationId: string,
  input: z.infer<typeof feedbackSubmissionSchema>,
) {
  const parsed = feedbackSubmissionSchema.parse(input);
  const application = await prisma.application.findUniqueOrThrow({
    where: { id: applicationId },
    include: {
      role: true,
      interview: {
        include: {
          transcript: true,
        },
      },
    },
  });

  const ai = getAiService();
  const review = await ai.reviewFeedback({
    roleTitle: application.role.title,
    feedbackText: parsed.content,
    transcriptSummary: application.interview?.transcript?.summary ?? "Transcript not available.",
  });

  await prisma.feedback.create({
    data: {
      applicationId,
      interviewId: application.interview?.id,
      authorName: parsed.authorName,
      authorRole: parsed.authorRole,
      content: parsed.content,
      structuredNotes: {
        rewriteSuggestion: review.rewriteSuggestion,
        reasoning: review.reasoning,
      },
      flaggedPhrases: review.flaggedPhrases,
      requiresAttention: review.requiresAttention,
    },
  });

  return review;
}

export async function generateOffer(applicationId: string, input: z.infer<typeof offerGenerationSchema>) {
  const parsed = offerGenerationSchema.parse(input);

  return generateOfferForApplication({
    applicationId,
    jobTitle: parsed.jobTitle,
    startDate: parsed.startDate,
    baseSalary: parsed.baseSalary,
    compensationNotes: parsed.compensationNotes,
    equityBonus: parsed.equityBonus,
    reportingManager: parsed.reportingManager,
    customTerms: parsed.customTerms,
    sendNow: parsed.sendNow,
  });
}
