import { z } from "zod";

const flexibleStringListSchema = z
  .union([z.array(z.string()), z.string(), z.null()])
  .optional();

export const screeningSchema = z.object({
  score: z.number().int().min(0).max(100),
  summary: z.string(),
  strengths: flexibleStringListSchema,
  gaps: flexibleStringListSchema,
  parsedSkills: flexibleStringListSchema,
  yearsExperience: z.number().int().min(0).nullable().optional(),
  education: z
    .object({
      highestDegree: z.string().optional(),
      focus: z.string().optional(),
    })
    .nullable()
    .optional(),
  pastEmployers: flexibleStringListSchema,
  achievements: flexibleStringListSchema,
});

export const researchSchema = z.object({
  brief: z.string(),
  linkedinSummary: z.string().nullable().optional(),
  xSummary: z.string().nullable().optional(),
  githubSummary: z.string().nullable().optional(),
  portfolioSummary: z.string().nullable().optional(),
  discrepancies: flexibleStringListSchema,
  limitations: flexibleStringListSchema,
  sources: z
    .array(
      z.object({
        label: z.string(),
        url: z.string().url(),
      }),
    )
    .optional()
    .default([]),
});

export const transcriptSummarySchema = z.object({
  summary: z.string(),
  bulletPoints: flexibleStringListSchema,
});

export const feedbackReviewSchema = z.object({
  requiresAttention: z.boolean(),
  flaggedPhrases: flexibleStringListSchema,
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

export type ScreeningResultPayload = {
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
  parsedSkills: string[];
  yearsExperience: number | null;
  education: {
    highestDegree: string;
    focus: string;
  } | null;
  pastEmployers: string[];
  achievements: string[];
};

export type ResearchResultPayload = {
  brief: string;
  linkedinSummary: string | null;
  xSummary: string | null;
  githubSummary: string | null;
  portfolioSummary: string | null;
  discrepancies: string[];
  limitations: string[];
  sources: Array<{
    label: string;
    url: string;
  }>;
};

export type TranscriptSummaryPayload = {
  summary: string;
  bulletPoints: string[];
};

export type FeedbackReviewPayload = {
  requiresAttention: boolean;
  flaggedPhrases: string[];
  rewriteSuggestion: string;
  reasoning: string;
};

export type OfferLetterPayload = z.infer<typeof offerLetterSchema>;
export type SlackWelcomePayload = z.infer<typeof slackWelcomeSchema>;
