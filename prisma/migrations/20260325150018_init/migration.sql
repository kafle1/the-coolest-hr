-- CreateEnum
CREATE TYPE "RoleStatus" AS ENUM ('OPEN', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('APPLIED', 'SCREENED', 'SHORTLISTED', 'INTERVIEW_PENDING', 'INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED', 'OFFER_DRAFT', 'OFFER_SENT', 'OFFER_SIGNED', 'SLACK_INVITED', 'ONBOARDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('SYSTEM', 'ADMIN', 'CANDIDATE', 'INTEGRATION');

-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('HELD', 'CONFIRMED', 'RELEASED', 'EXPIRED', 'DECLINED');

-- CreateEnum
CREATE TYPE "InterviewResponseStatus" AS ENUM ('NEEDS_ACTION', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'SENT', 'SIGNED');

-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'PREVIEW', 'FAILED');

-- CreateEnum
CREATE TYPE "OnboardingEventType" AS ENUM ('SLACK_INVITE_SENT', 'SLACK_TEAM_JOIN', 'WELCOME_SENT', 'HR_NOTIFIED');

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "remoteStatus" TEXT NOT NULL,
    "experienceLevel" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "responsibilities" TEXT[],
    "requirements" TEXT[],
    "status" "RoleStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "linkedinUrl" TEXT NOT NULL,
    "portfolioUrl" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'APPLIED',
    "aiScore" INTEGER,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumeAsset" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "extractedText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResumeAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningResult" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "strengths" TEXT[],
    "gaps" TEXT[],
    "parsedSkills" TEXT[],
    "yearsExperience" INTEGER,
    "education" JSONB,
    "pastEmployers" TEXT[],
    "achievements" TEXT[],
    "autoShortlisted" BOOLEAN NOT NULL DEFAULT false,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreeningResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchProfile" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "linkedinSummary" TEXT,
    "xSummary" TEXT,
    "githubSummary" TEXT,
    "portfolioSummary" TEXT,
    "discrepancies" TEXT[],
    "limitations" TEXT[],
    "sources" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewPlan" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "interviewerName" TEXT NOT NULL,
    "interviewerEmail" TEXT NOT NULL,
    "interviewerCalendarId" TEXT NOT NULL,
    "stageLabel" TEXT NOT NULL DEFAULT 'Hiring Manager Interview',
    "lastOptionsSentAt" TIMESTAMP(3),
    "lastNudgeAt" TIMESTAMP(3),
    "candidateRequestNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewSlotHold" (
    "id" TEXT NOT NULL,
    "interviewPlanId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "HoldStatus" NOT NULL DEFAULT 'HELD',
    "googleCalendarEventId" TEXT,
    "candidateMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewSlotHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "interviewPlanId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "googleEventId" TEXT,
    "meetingUrl" TEXT,
    "attendeeResponseStatus" "InterviewResponseStatus" NOT NULL DEFAULT 'NEEDS_ACTION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transcript" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerMeetingId" TEXT,
    "summary" TEXT NOT NULL,
    "bulletPoints" TEXT[],
    "fullText" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "interviewId" TEXT,
    "authorName" TEXT NOT NULL,
    "authorRole" TEXT,
    "content" TEXT NOT NULL,
    "structuredNotes" JSONB,
    "flaggedPhrases" TEXT[],
    "requiresAttention" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "jobTitle" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "baseSalary" TEXT NOT NULL,
    "compensationNotes" TEXT,
    "equityBonus" TEXT,
    "reportingManager" TEXT NOT NULL,
    "customTerms" TEXT,
    "generatedContent" TEXT NOT NULL,
    "generatedHtml" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "signerName" TEXT,
    "signerIp" TEXT,
    "signatureDataUrl" TEXT,
    "alertSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingEvent" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "type" "OnboardingEventType" NOT NULL,
    "payload" JSONB,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusHistory" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "fromStatus" "ApplicationStatus",
    "toStatus" "ApplicationStatus" NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorLabel" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "deliveryStatus" "EmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_slug_key" ON "Role"("slug");

-- CreateIndex
CREATE INDEX "Application_status_idx" ON "Application"("status");

-- CreateIndex
CREATE INDEX "Application_submittedAt_idx" ON "Application"("submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Application_email_roleId_key" ON "Application"("email", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeAsset_applicationId_key" ON "ResumeAsset"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningResult_applicationId_key" ON "ScreeningResult"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchProfile_applicationId_key" ON "ResearchProfile"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewPlan_applicationId_key" ON "InterviewPlan"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewSlotHold_token_key" ON "InterviewSlotHold"("token");

-- CreateIndex
CREATE INDEX "InterviewSlotHold_interviewPlanId_status_idx" ON "InterviewSlotHold"("interviewPlanId", "status");

-- CreateIndex
CREATE INDEX "InterviewSlotHold_startsAt_status_idx" ON "InterviewSlotHold"("startsAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Interview_applicationId_key" ON "Interview"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "Interview_interviewPlanId_key" ON "Interview"("interviewPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "Interview_googleEventId_key" ON "Interview"("googleEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Transcript_interviewId_key" ON "Transcript"("interviewId");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_applicationId_key" ON "Offer"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_token_key" ON "Offer"("token");

-- CreateIndex
CREATE INDEX "OnboardingEvent_applicationId_type_idx" ON "OnboardingEvent"("applicationId", "type");

-- CreateIndex
CREATE INDEX "StatusHistory_applicationId_createdAt_idx" ON "StatusHistory"("applicationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeAsset" ADD CONSTRAINT "ResumeAsset_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningResult" ADD CONSTRAINT "ScreeningResult_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchProfile" ADD CONSTRAINT "ResearchProfile_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewPlan" ADD CONSTRAINT "InterviewPlan_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewSlotHold" ADD CONSTRAINT "InterviewSlotHold_interviewPlanId_fkey" FOREIGN KEY ("interviewPlanId") REFERENCES "InterviewPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_interviewPlanId_fkey" FOREIGN KEY ("interviewPlanId") REFERENCES "InterviewPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingEvent" ADD CONSTRAINT "OnboardingEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusHistory" ADD CONSTRAINT "StatusHistory_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;
