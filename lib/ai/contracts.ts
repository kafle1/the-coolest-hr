import { z } from "zod";

export const screeningSchema = z.object({
  score: z.number().int().min(0).max(100),
  summary: z.string(),
  strengths: z.array(z.string()).min(1),
  gaps: z.array(z.string()).min(1),
  parsedSkills: z.array(z.string()).min(1),
  yearsExperience: z.number().int().min(0).nullable(),
  education: z
    .object({
      highestDegree: z.string(),
      focus: z.string(),
    })
    .nullable(),
  pastEmployers: z.array(z.string()),
  achievements: z.array(z.string()),
});

export const researchSchema = z.object({
  brief: z.string(),
  linkedinSummary: z.string().nullable(),
  xSummary: z.string().nullable(),
  githubSummary: z.string().nullable(),
  portfolioSummary: z.string().nullable(),
  discrepancies: z.array(z.string()),
  limitations: z.array(z.string()),
  sources: z.array(
    z.object({
      label: z.string(),
      url: z.string().url(),
    }),
  ),
});

export const transcriptSummarySchema = z.object({
  summary: z.string(),
  bulletPoints: z.array(z.string()).min(3),
});

export const feedbackReviewSchema = z.object({
  requiresAttention: z.boolean(),
  flaggedPhrases: z.array(z.string()),
  rewriteSuggestion: z.string(),
  reasoning: z.string(),
});

export const offerLetterSchema = z.object({
  subjectLine: z.string(),
  bodyText: z.string(),
});

export const slackWelcomeSchema = z.object({
  message: z.string(),
});

export type ScreeningResultPayload = z.infer<typeof screeningSchema>;
export type ResearchResultPayload = z.infer<typeof researchSchema>;
export type TranscriptSummaryPayload = z.infer<typeof transcriptSummarySchema>;
export type FeedbackReviewPayload = z.infer<typeof feedbackReviewSchema>;
export type OfferLetterPayload = z.infer<typeof offerLetterSchema>;
export type SlackWelcomePayload = z.infer<typeof slackWelcomeSchema>;
