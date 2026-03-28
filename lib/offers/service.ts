import { randomUUID } from "node:crypto";

import {
  ActorType,
  ApplicationStatus,
  OfferStatus,
  OnboardingEventType,
} from "@prisma/client";

import { getAiService } from "@/lib/ai/service";
import { sendOfferSignedAlert } from "@/lib/email/service";
import { prisma } from "@/lib/prisma/client";
import { getSlackService } from "@/lib/slack/service";
import { appendStatusNote, transitionApplicationStatus } from "@/lib/status/transitions";
import { persistOfferHtml } from "@/lib/storage/files";
import { env } from "@/lib/utils/env";
import { badRequest, conflict } from "@/lib/utils/errors";
import { escapeHtml, renderPlainTextParagraphs } from "@/lib/utils/html";
import { formatDateOnly } from "@/lib/utils/format";

function renderOfferHtml(input: {
  candidateName: string;
  roleTitle: string;
  startDate: Date;
  baseSalary: string;
  managerName: string;
  bodyText: string;
}) {
  const paragraphs = renderPlainTextParagraphs(input.bodyText);

  return `
    <article style="font-family: Arial, Helvetica, sans-serif; max-width: 720px; margin: 0 auto; color: #0f172a;">
      <header style="border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 24px;">
        <p style="margin: 0; font-size: 14px; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b;">Niural Offer</p>
        <h1 style="margin: 8px 0 0; font-size: 32px;">${escapeHtml(input.roleTitle)}</h1>
        <p style="margin: 12px 0 0; color: #475569;">Candidate: ${escapeHtml(input.candidateName)}</p>
        <p style="margin: 4px 0 0; color: #475569;">Start date: ${escapeHtml(formatDateOnly(input.startDate))}</p>
        <p style="margin: 4px 0 0; color: #475569;">Base salary: ${escapeHtml(input.baseSalary)}</p>
        <p style="margin: 4px 0 0; color: #475569;">Manager: ${escapeHtml(input.managerName)}</p>
      </header>
      ${paragraphs}
    </article>
  `;
}

async function loadOfferForWorkflow(offerId: string) {
  return prisma.offer.findUniqueOrThrow({
    where: { id: offerId },
    include: {
      application: {
        include: {
          role: true,
        },
      },
    },
  });
}

export async function generateOfferForApplication(input: {
  applicationId: string;
  jobTitle: string;
  startDate: Date;
  baseSalary: string;
  compensationNotes?: string;
  equityBonus?: string;
  reportingManager: string;
  customTerms?: string;
  sendNow?: boolean;
}) {
  const draftableStatuses: ApplicationStatus[] = [
    ApplicationStatus.INTERVIEW_COMPLETED,
    ApplicationStatus.OFFER_DRAFT,
  ];
  const sendableStatuses: ApplicationStatus[] = [
    ...draftableStatuses,
    ApplicationStatus.OFFER_SENT,
  ];

  const application = await prisma.application.findUniqueOrThrow({
    where: { id: input.applicationId },
    include: {
      role: true,
      offer: true,
    },
  });

  if (input.sendNow) {
    if (!sendableStatuses.includes(application.status)) {
      throw conflict("This candidate is not ready for a sent offer.", "offer_not_sendable");
    }
  } else if (!draftableStatuses.includes(application.status)) {
    throw conflict("This candidate is not ready for an offer draft.", "offer_not_draftable");
  }

  const ai = getAiService();
  const draft = await ai.generateOfferLetter({
    candidateName: application.fullName,
    roleTitle: input.jobTitle,
    managerName: input.reportingManager,
    startDate: formatDateOnly(input.startDate),
    baseSalary: input.baseSalary,
    compensationNotes: input.compensationNotes,
    equityBonus: input.equityBonus,
    customTerms: input.customTerms,
  });

  const token = application.offer?.token ?? randomUUID();
  const html = renderOfferHtml({
    candidateName: application.fullName,
    roleTitle: input.jobTitle,
    startDate: input.startDate,
    baseSalary: input.baseSalary,
    managerName: input.reportingManager,
    bodyText: draft.bodyText,
  });

  const offer = await prisma.offer.upsert({
    where: { applicationId: input.applicationId },
    update: {
      token,
      jobTitle: input.jobTitle,
      startDate: input.startDate,
      baseSalary: input.baseSalary,
      compensationNotes: input.compensationNotes,
      equityBonus: input.equityBonus,
      reportingManager: input.reportingManager,
      customTerms: input.customTerms,
      generatedContent: draft.bodyText,
      generatedHtml: html,
      status: input.sendNow ? OfferStatus.SENT : OfferStatus.DRAFT,
      sentAt: input.sendNow ? new Date() : null,
    },
    create: {
      applicationId: input.applicationId,
      token,
      jobTitle: input.jobTitle,
      startDate: input.startDate,
      baseSalary: input.baseSalary,
      compensationNotes: input.compensationNotes,
      equityBonus: input.equityBonus,
      reportingManager: input.reportingManager,
      customTerms: input.customTerms,
      generatedContent: draft.bodyText,
      generatedHtml: html,
      status: input.sendNow ? OfferStatus.SENT : OfferStatus.DRAFT,
      sentAt: input.sendNow ? new Date() : null,
    },
  });

  await persistOfferHtml(offer.id, html);

  if (input.sendNow) {
    if (application.status === ApplicationStatus.INTERVIEW_COMPLETED) {
      await transitionApplicationStatus({
        applicationId: input.applicationId,
        toStatus: ApplicationStatus.OFFER_DRAFT,
        actorType: ActorType.ADMIN,
        actorLabel: "Admin dashboard",
        note: "Offer draft generated for review.",
      });
    }

    await transitionApplicationStatus({
      applicationId: input.applicationId,
      toStatus: ApplicationStatus.OFFER_SENT,
      actorType: ActorType.ADMIN,
      actorLabel: "Admin dashboard",
      note: "Offer generated and sent.",
    });
  } else {
    await transitionApplicationStatus({
      applicationId: input.applicationId,
      toStatus: ApplicationStatus.OFFER_DRAFT,
      actorType: ActorType.ADMIN,
      actorLabel: "Admin dashboard",
      note: "Offer draft generated for review.",
    });
  }

  return offer;
}

export async function signOffer(input: {
  offerId: string;
  signerName: string;
  signerIp: string;
  signatureDataUrl: string;
}) {
  const signerName = input.signerName.trim();

  if (signerName.length < 2) {
    throw badRequest("Your full legal name is required.", "signer_name_required");
  }

  if (!/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(input.signatureDataUrl)) {
    throw badRequest("Signature must be a valid PNG image.", "invalid_signature_image");
  }

  let offer = await loadOfferForWorkflow(input.offerId);

  if (offer.status === OfferStatus.DRAFT) {
    throw conflict("Offer must be sent before it can be signed.", "offer_not_sent");
  }

  if (offer.status !== OfferStatus.SIGNED) {
    await prisma.offer.update({
      where: { id: input.offerId },
      data: {
        status: OfferStatus.SIGNED,
        signerName,
        signerIp: input.signerIp,
        signatureDataUrl: input.signatureDataUrl,
        signedAt: new Date(),
      },
    });

    offer = await loadOfferForWorkflow(input.offerId);
  }

  if (offer.application.status === ApplicationStatus.OFFER_SENT) {
    await transitionApplicationStatus({
      applicationId: offer.applicationId,
      toStatus: ApplicationStatus.OFFER_SIGNED,
      actorType: ActorType.CANDIDATE,
      actorLabel: signerName,
      note: "Candidate signed the offer.",
    });
  }

  const alertLog = await prisma.emailLog.findFirst({
    where: {
      applicationId: offer.applicationId,
      templateKey: "offer-signed-alert",
    },
    select: { id: true },
  });

  if (!alertLog) {
    try {
      await sendOfferSignedAlert({
        applicationId: offer.applicationId,
        candidateName: offer.application.fullName,
        toEmail: env.interviewerEmail,
        roleTitle: offer.jobTitle,
      });

      await prisma.offer.update({
        where: { id: offer.id },
        data: {
          alertSentAt: new Date(),
        },
      });
    } catch (error) {
      await appendStatusNote({
        applicationId: offer.applicationId,
        actorType: ActorType.SYSTEM,
        actorLabel: "Offer signed alert",
        note: `Offer was signed, but the interviewer alert email failed: ${error instanceof Error ? error.message : "Unknown error."}`,
      });
    }
  }

  const existingSlackInvite = await prisma.onboardingEvent.findFirst({
    where: {
      applicationId: offer.applicationId,
      type: OnboardingEventType.SLACK_INVITE_SENT,
    },
    select: { id: true },
  });

  if (!existingSlackInvite) {
    try {
      const slack = getSlackService();
      const invite = await slack.inviteCandidate({
        email: offer.application.email,
      });

      await prisma.onboardingEvent.create({
        data: {
          applicationId: offer.applicationId,
          type: OnboardingEventType.SLACK_INVITE_SENT,
          externalId: invite.externalId,
          payload: {
            email: offer.application.email,
          },
        },
      });
    } catch (error) {
      await appendStatusNote({
        applicationId: offer.applicationId,
        actorType: ActorType.SYSTEM,
        actorLabel: "Slack invite",
        note: `Offer was signed, but the Slack invite failed: ${error instanceof Error ? error.message : "Unknown error."}`,
      });
    }
  }

  const latestApplication = await prisma.application.findUniqueOrThrow({
    where: { id: offer.applicationId },
    select: { status: true },
  });

  if (latestApplication.status === ApplicationStatus.OFFER_SIGNED) {
    await transitionApplicationStatus({
      applicationId: offer.applicationId,
      toStatus: ApplicationStatus.SLACK_INVITED,
      actorType: ActorType.INTEGRATION,
      actorLabel: "Slack",
      note: "Slack invitation sent after offer signature.",
    });
  }

  return loadOfferForWorkflow(input.offerId);
}

export async function completeSlackOnboarding(input: {
  email: string;
  slackUserId: string;
}) {
  const application = await prisma.application.findFirstOrThrow({
    where: {
      email: {
        equals: input.email.trim(),
        mode: "insensitive",
      },
      offer: {
        is: {
          status: OfferStatus.SIGNED,
        },
      },
    },
    include: {
      offer: true,
      role: true,
    },
  });

  const existingEvents = await prisma.onboardingEvent.findMany({
    where: {
      applicationId: application.id,
      type: {
        in: [
          OnboardingEventType.SLACK_TEAM_JOIN,
          OnboardingEventType.WELCOME_SENT,
          OnboardingEventType.HR_NOTIFIED,
        ],
      },
    },
    select: {
      type: true,
      externalId: true,
    },
  });

  const hasTeamJoinEvent = existingEvents.some(
    (event) =>
      event.type === OnboardingEventType.SLACK_TEAM_JOIN &&
      event.externalId === input.slackUserId,
  );
  const hasWelcomeSent = existingEvents.some(
    (event) => event.type === OnboardingEventType.WELCOME_SENT,
  );
  const hasHrNotified = existingEvents.some(
    (event) => event.type === OnboardingEventType.HR_NOTIFIED,
  );

  if (!hasTeamJoinEvent) {
    await prisma.onboardingEvent.create({
      data: {
        applicationId: application.id,
        type: OnboardingEventType.SLACK_TEAM_JOIN,
        externalId: input.slackUserId,
        payload: {
          email: input.email,
        },
      },
    });
  }

  if (!hasWelcomeSent) {
    const ai = getAiService();
    const slack = getSlackService();
    const welcome = await ai.generateSlackWelcome({
      candidateName: application.fullName,
      roleTitle: application.offer?.jobTitle ?? application.role.title,
      startDate: formatDateOnly(application.offer?.startDate ?? new Date()),
      managerName: application.offer?.reportingManager ?? env.interviewerName,
    });

    await slack.sendDirectMessage({
      slackUserId: input.slackUserId,
      text: welcome.message,
    });

    await prisma.onboardingEvent.create({
      data: {
        applicationId: application.id,
        type: OnboardingEventType.WELCOME_SENT,
        payload: {
          message: welcome.message,
        },
      },
    });
  }

  if (!hasHrNotified) {
    const slack = getSlackService();

    await slack.notifyHr({
      text: `${application.fullName} joined Slack and has been welcomed.`,
    });

    await prisma.onboardingEvent.create({
      data: {
        applicationId: application.id,
        type: OnboardingEventType.HR_NOTIFIED,
      },
    });
  }

  if (application.status !== ApplicationStatus.ONBOARDED) {
    await transitionApplicationStatus({
      applicationId: application.id,
      toStatus: ApplicationStatus.ONBOARDED,
      actorType: ActorType.INTEGRATION,
      actorLabel: "Slack",
      note: "Candidate joined Slack and onboarding message was sent.",
    });
  }

  return prisma.application.findUniqueOrThrow({
    where: { id: application.id },
    include: {
      offer: true,
      role: true,
    },
  });
}
