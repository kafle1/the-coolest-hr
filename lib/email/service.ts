import { Resend } from "resend";

import { prisma } from "@/lib/prisma/client";
import { escapeHtml } from "@/lib/utils/html";
import { env } from "@/lib/utils/env";
import { formatDateTime } from "@/lib/utils/format";

type SendEmailInput = {
  applicationId?: string;
  toEmail: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  templateKey: string;
};

export interface MailService {
  sendEmail(input: SendEmailInput): Promise<void>;
}

class LocalMailService implements MailService {
  async sendEmail(input: SendEmailInput) {
    await prisma.emailLog.create({
      data: {
        applicationId: input.applicationId,
        toEmail: input.toEmail,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText,
        templateKey: input.templateKey,
        deliveryStatus: "PREVIEW",
      },
    });
  }
}

class ResendMailService implements MailService {
  private readonly client = new Resend(env.resendApiKey);

  async sendEmail(input: SendEmailInput) {
    try {
      const response = await this.client.emails.send({
        from: env.resendFromEmail,
        to: input.toEmail,
        subject: input.subject,
        html: input.bodyHtml,
        text: input.bodyText,
      });

      await prisma.emailLog.create({
        data: {
          applicationId: input.applicationId,
          toEmail: input.toEmail,
          subject: input.subject,
          bodyHtml: input.bodyHtml,
          bodyText: input.bodyText,
          templateKey: input.templateKey,
          deliveryStatus: "SENT",
          providerMessageId: response.data?.id ?? undefined,
        },
      });
    } catch (error) {
      await prisma.emailLog.create({
        data: {
          applicationId: input.applicationId,
          toEmail: input.toEmail,
          subject: input.subject,
          bodyHtml: input.bodyHtml,
          bodyText: input.bodyText,
          templateKey: input.templateKey,
          deliveryStatus: "FAILED",
        },
      });

      throw error;
    }
  }
}

function getMailService(): MailService {
  if (process.env.NODE_ENV === "test" || !env.resendApiKey) {
    return new LocalMailService();
  }

  return new ResendMailService();
}

function buildHtmlShell(title: string, body: string) {
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #111827;">
      <h1 style="font-size: 22px; margin-bottom: 12px;">${title}</h1>
      ${body}
    </div>
  `;
}

export async function sendApplicationConfirmation(input: {
  applicationId: string;
  candidateName: string;
  toEmail: string;
  roleTitle: string;
}) {
  const mailer = getMailService();
  const subject = `We received your ${input.roleTitle} application`;
  const bodyText = `Hi ${input.candidateName},\n\nWe received your application for the ${input.roleTitle} role. We are screening your resume now and will keep you posted on next steps.\n\nNiural Hiring`;
  const bodyHtml = buildHtmlShell(
    "Application received",
    `<p>Hi ${escapeHtml(input.candidateName)},</p><p>We received your application for the <strong>${escapeHtml(input.roleTitle)}</strong> role. We are screening your resume now and will keep you posted on next steps.</p><p>Niural Hiring</p>`,
  );

  await mailer.sendEmail({
    applicationId: input.applicationId,
    toEmail: input.toEmail,
    subject,
    bodyHtml,
    bodyText,
    templateKey: "application-confirmation",
  });
}

export async function sendSchedulingOptionsEmail(input: {
  applicationId: string;
  candidateName: string;
  toEmail: string;
  roleTitle: string;
  options: Array<{ startsAt: Date; url: string }>;
}) {
  const mailer = getMailService();
  const subject = `Choose your ${input.roleTitle} interview slot`;
  const listHtml = input.options
    .map(
      (option) =>
        `<li><a href="${option.url}">${formatDateTime(option.startsAt)}</a></li>`,
    )
    .join("");
  const listText = input.options
    .map((option) => `- ${formatDateTime(option.startsAt)}: ${option.url}`)
    .join("\n");

  await mailer.sendEmail({
    applicationId: input.applicationId,
    toEmail: input.toEmail,
    subject,
    bodyHtml: buildHtmlShell(
      "Interview options",
      `<p>Hi ${escapeHtml(input.candidateName)},</p><p>Please choose one of the interview slots below for the ${escapeHtml(input.roleTitle)} role:</p><ul>${listHtml}</ul><p>If none of these work, use the reschedule form on any slot page.</p>`,
    ),
    bodyText: `Hi ${input.candidateName},\n\nPlease choose one of the interview slots below for the ${input.roleTitle} role:\n${listText}\n\nIf none of these work, use the reschedule form on any slot page.`,
    templateKey: "scheduling-options",
  });
}

export async function sendSchedulingNudgeEmail(input: {
  applicationId: string;
  candidateName: string;
  toEmail: string;
  roleTitle: string;
  options: Array<{ startsAt: Date; url: string }>;
}) {
  const mailer = getMailService();
  const subject = `Reminder: choose your ${input.roleTitle} interview slot`;
  const listHtml = input.options
    .map(
      (option) =>
        `<li><a href="${option.url}">${formatDateTime(option.startsAt)}</a></li>`,
    )
    .join("");
  const listText = input.options
    .map((option) => `- ${formatDateTime(option.startsAt)}: ${option.url}`)
    .join("\n");

  await mailer.sendEmail({
    applicationId: input.applicationId,
    toEmail: input.toEmail,
    subject,
    bodyHtml: buildHtmlShell(
      "Interview scheduling reminder",
      `<p>Hi ${escapeHtml(input.candidateName)},</p><p>You still have active interview options for the <strong>${escapeHtml(input.roleTitle)}</strong> role.</p><ul>${listHtml}</ul><p>If none of these work, use the reschedule form on any slot page and we will offer alternatives.</p>`,
    ),
    bodyText: `Hi ${input.candidateName},\n\nYou still have active interview options for the ${input.roleTitle} role:\n${listText}\n\nIf none of these work, use the reschedule form on any slot page and we will offer alternatives.`,
    templateKey: "scheduling-nudge",
  });
}

export async function sendInterviewRescheduleAlert(input: {
  applicationId: string;
  candidateName: string;
  candidateEmail: string;
  interviewerEmail: string;
  note: string;
}) {
  const mailer = getMailService();

  await mailer.sendEmail({
    applicationId: input.applicationId,
    toEmail: input.interviewerEmail,
    subject: `${input.candidateName} requested a different interview time`,
    bodyHtml: buildHtmlShell(
      "Candidate reschedule request",
      `<p>${escapeHtml(input.candidateName)} (${escapeHtml(input.candidateEmail)}) asked for a different interview time.</p><p><strong>Requested note:</strong> ${escapeHtml(input.note)}</p>`,
    ),
    bodyText: `${input.candidateName} (${input.candidateEmail}) asked for a different interview time.\n\nRequested note: ${input.note}`,
    templateKey: "interview-reschedule-alert",
  });
}

export async function sendOfferSignedAlert(input: {
  applicationId: string;
  candidateName: string;
  toEmail: string;
  roleTitle: string;
}) {
  const mailer = getMailService();

  await mailer.sendEmail({
    applicationId: input.applicationId,
    toEmail: input.toEmail,
    subject: `${input.candidateName} signed the ${input.roleTitle} offer`,
    bodyHtml: buildHtmlShell(
      "Offer signed",
      `<p>${escapeHtml(input.candidateName)} has signed the offer for <strong>${escapeHtml(input.roleTitle)}</strong>.</p>`,
    ),
    bodyText: `${input.candidateName} has signed the offer for ${input.roleTitle}.`,
    templateKey: "offer-signed-alert",
  });
}
