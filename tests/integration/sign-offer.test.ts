// @vitest-environment node

import {
  ApplicationStatus,
  OfferStatus,
  OnboardingEventType,
  RoleStatus,
} from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { signOffer } from "@/lib/offers/service";
import { prisma } from "@/lib/prisma/client";
import { disconnectDatabase, resetDatabase } from "@/tests/helpers/db";

describe("signOffer", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it("signs the offer and triggers Slack invite state", async () => {
    const role = await prisma.role.create({
      data: {
        slug: "offer-role",
        title: "AI Product Operator",
        team: "Product",
        location: "Nepal",
        remoteStatus: "Remote",
        experienceLevel: "Senior",
        summary: "Offer role",
        responsibilities: ["Ship tools"],
        requirements: ["Write code"],
        status: RoleStatus.OPEN,
      },
    });

    const application = await prisma.application.create({
      data: {
        fullName: "Offer Candidate",
        email: "offer@example.com",
        linkedinUrl: "https://linkedin.com/in/offer",
        status: ApplicationStatus.OFFER_SENT,
        roleId: role.id,
      },
    });

    const offer = await prisma.offer.create({
      data: {
        applicationId: application.id,
        token: "offer-token",
        status: OfferStatus.SENT,
        jobTitle: role.title,
        startDate: new Date("2026-04-15T00:00:00.000Z"),
        baseSalary: "NPR 300,000 / month",
        reportingManager: "Jordan Lee",
        generatedContent: "Offer body",
        generatedHtml: "<p>Offer body</p>",
        sentAt: new Date(),
      },
    });

    const signedOffer = await signOffer({
      offerId: offer.id,
      signerName: "Offer Candidate",
      signerIp: "127.0.0.1",
      signatureDataUrl: "data:image/png;base64,abc",
    });

    const updatedApplication = await prisma.application.findUniqueOrThrow({
      where: { id: application.id },
    });
    const updatedOffer = await prisma.offer.findUniqueOrThrow({
      where: { id: offer.id },
    });
    const onboardingEvent = await prisma.onboardingEvent.findFirstOrThrow({
      where: { applicationId: application.id },
    });
    const emailLog = await prisma.emailLog.findFirstOrThrow({
      where: { applicationId: application.id },
    });

    expect(updatedOffer.status).toBe(OfferStatus.SIGNED);
    expect(updatedApplication.status).toBe(ApplicationStatus.SLACK_INVITED);
    expect(onboardingEvent.type).toBe(OnboardingEventType.SLACK_INVITE_SENT);
    expect(emailLog.templateKey).toBe("offer-signed-alert");
    expect(signedOffer.application.status).toBe(ApplicationStatus.SLACK_INVITED);
    expect(signedOffer.alertSentAt).not.toBeNull();
  });

  it("does not duplicate alerts or Slack invite events when signing is retried", async () => {
    const role = await prisma.role.create({
      data: {
        slug: "offer-role-idempotent",
        title: "AI Product Operator",
        team: "Product",
        location: "Nepal",
        remoteStatus: "Remote",
        experienceLevel: "Senior",
        summary: "Offer role",
        responsibilities: ["Ship tools"],
        requirements: ["Write code"],
        status: RoleStatus.OPEN,
      },
    });

    const application = await prisma.application.create({
      data: {
        fullName: "Retry Candidate",
        email: "retry@example.com",
        linkedinUrl: "https://linkedin.com/in/retry",
        status: ApplicationStatus.OFFER_SENT,
        roleId: role.id,
      },
    });

    const offer = await prisma.offer.create({
      data: {
        applicationId: application.id,
        token: "offer-token-retry",
        status: OfferStatus.SENT,
        jobTitle: role.title,
        startDate: new Date("2026-04-15T00:00:00.000Z"),
        baseSalary: "NPR 300,000 / month",
        reportingManager: "Jordan Lee",
        generatedContent: "Offer body",
        generatedHtml: "<p>Offer body</p>",
        sentAt: new Date(),
      },
    });

    await signOffer({
      offerId: offer.id,
      signerName: "Retry Candidate",
      signerIp: "127.0.0.1",
      signatureDataUrl: "data:image/png;base64,first",
    });

    const signedOffer = await signOffer({
      offerId: offer.id,
      signerName: "Retry Candidate",
      signerIp: "127.0.0.1",
      signatureDataUrl: "data:image/png;base64,second",
    });

    const inviteEvents = await prisma.onboardingEvent.count({
      where: {
        applicationId: application.id,
        type: OnboardingEventType.SLACK_INVITE_SENT,
      },
    });
    const alertLogs = await prisma.emailLog.count({
      where: {
        applicationId: application.id,
        templateKey: "offer-signed-alert",
      },
    });

    expect(inviteEvents).toBe(1);
    expect(alertLogs).toBe(1);
    expect(signedOffer.application.status).toBe(ApplicationStatus.SLACK_INVITED);
    expect(signedOffer.signatureDataUrl).toBe("data:image/png;base64,first");
  });
});
