import { randomUUID } from "node:crypto";

import { Resend } from "resend";

import { prisma } from "@/lib/prisma/client";
import { env } from "@/lib/utils/env";
import { formatDateOnly, formatDateTime } from "@/lib/utils/format";
import { escapeHtml } from "@/lib/utils/html";

type EmailAttachment = {
  filename: string;
  content: string;
  contentType?: string;
};

type SendEmailInput = {
  applicationId?: string;
  toEmail: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  templateKey: string;
  attachments?: EmailAttachment[];
};

type MailServiceResult = {
  providerMessageId?: string;
};

export interface MailService {
  sendEmail(input: SendEmailInput): Promise<MailServiceResult>;
}

function buildHtmlShell(title: string, body: string) {
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #111827;">
      <h1 style="font-size: 22px; margin-bottom: 12px;">${title}</h1>
      ${body}
    </div>
  `;
}

function readProviderErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (!error || typeof error !== "object") {
    return "Unknown email provider error.";
  }

  const candidate = error as {
    message?: string;
    name?: string;
    error?: {
      message?: string;
    };
  };

  return (
    candidate.error?.message?.trim() ||
    candidate.message?.trim() ||
    candidate.name?.trim() ||
    "Unknown email provider error."
  );
}

async function persistEmailLog(
  input: SendEmailInput,
  deliveryStatus: "FAILED" | "PREVIEW" | "SENT",
  providerMessageId?: string,
) {
  await prisma.emailLog.create({
    data: {
      applicationId: input.applicationId,
      toEmail: input.toEmail,
      subject: input.subject,
      bodyHtml: input.bodyHtml,
      bodyText: input.bodyText,
      templateKey: input.templateKey,
      deliveryStatus,
      providerMessageId,
    },
  });
}

class LocalMailService implements MailService {
  async sendEmail(input: SendEmailInput) {
    await persistEmailLog(input, "PREVIEW");
    return {};
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
        attachments: input.attachments,
      });

      if (response.error) {
        throw new Error(readProviderErrorMessage(response.error));
      }

      await persistEmailLog(input, "SENT", response.data?.id ?? undefined);

      return {
        providerMessageId: response.data?.id ?? undefined,
      };
    } catch (error) {
      await persistEmailLog(input, "FAILED");
      throw new Error(readProviderErrorMessage(error));
    }
  }
}

function getMailService(): MailService {
  if (process.env.NODE_ENV === "test" || !env.resendApiKey) {
    return new LocalMailService();
  }

  return new ResendMailService();
}

function escapeIcsValue(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");
}

function formatIcsDate(value: Date) {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildInterviewInviteAttachment(input: {
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
  const uid = `${input.googleEventId ?? randomUUID()}@niural-hiring`;
  const timestamp = formatIcsDate(new Date());
  const description = [
    `Interview for ${input.roleTitle}.`,
    `Google Meet: ${input.meetingUrl}`,
  ].join("\n");

  const content = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Niural Hiring OS//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${timestamp}`,
    `DTSTART:${formatIcsDate(input.startsAt)}`,
    `DTEND:${formatIcsDate(input.endsAt)}`,
    `SUMMARY:${escapeIcsValue(`${input.roleTitle} interview`)}`,
    `DESCRIPTION:${escapeIcsValue(description)}`,
    `ORGANIZER;CN=${escapeIcsValue(input.interviewerName)}:mailto:${input.interviewerEmail}`,
    `ATTENDEE;CN=${escapeIcsValue(input.candidateName)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${input.candidateEmail}`,
    `URL:${input.meetingUrl}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return {
    filename: "interview-invite.ics",
    content: Buffer.from(content, "utf8").toString("base64"),
    contentType: "text/calendar; method=REQUEST; charset=UTF-8",
  } satisfies EmailAttachment;
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

export async function sendInterviewConfirmationEmail(input: {
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
  const mailer = getMailService();
  const subject = `Confirmed: your ${input.roleTitle} interview`;
  const inviteAttachment = buildInterviewInviteAttachment(input);
  const bodyText = `Hi ${input.candidateName},\n\nYour ${input.roleTitle} interview is confirmed for ${formatDateTime(input.startsAt)}.\n\nGoogle Meet: ${input.meetingUrl}\n\nA calendar invite is attached to this email.\n\nNiural Hiring`;
  const bodyHtml = buildHtmlShell(
    "Interview confirmed",
    `<p>Hi ${escapeHtml(input.candidateName)},</p><p>Your <strong>${escapeHtml(input.roleTitle)}</strong> interview is confirmed for <strong>${escapeHtml(formatDateTime(input.startsAt))}</strong>.</p><p><a href="${input.meetingUrl}">Open Google Meet</a></p><p>A calendar invite is attached to this email.</p><p>Niural Hiring</p>`,
  );

  await mailer.sendEmail({
    applicationId: input.applicationId,
    toEmail: input.candidateEmail,
    subject,
    bodyHtml,
    bodyText,
    templateKey: "interview-confirmation",
    attachments: [inviteAttachment],
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

export async function sendOfferLetterEmail(input: {
  applicationId: string;
  candidateName: string;
  toEmail: string;
  roleTitle: string;
  startDate: Date;
  baseSalary: string;
  signingUrl: string;
}) {
  const mailer = getMailService();
  const subject = `Your ${input.roleTitle} offer from Niural`;
  const bodyText = [
    `Hi ${input.candidateName},`,
    "",
    `We are excited to send your offer for the ${input.roleTitle} role.`,
    `Start date: ${formatDateOnly(input.startDate)}`,
    `Base salary: ${input.baseSalary}`,
    "",
    `Review and sign your offer here: ${input.signingUrl}`,
    "",
    "Niural Hiring",
  ].join("\n");
  const bodyHtml = buildHtmlShell(
    "Your offer is ready",
    `<p>Hi ${escapeHtml(input.candidateName)},</p>
     <p>We are excited to send your offer for the <strong>${escapeHtml(input.roleTitle)}</strong> role.</p>
     <p><strong>Start date:</strong> ${escapeHtml(formatDateOnly(input.startDate))}<br /><strong>Base salary:</strong> ${escapeHtml(input.baseSalary)}</p>
     <p><a href="${input.signingUrl}">Review and sign your offer</a></p>
     <p>Niural Hiring</p>`,
  );

  await mailer.sendEmail({
    applicationId: input.applicationId,
    toEmail: input.toEmail,
    subject,
    bodyHtml,
    bodyText,
    templateKey: "offer-letter",
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
