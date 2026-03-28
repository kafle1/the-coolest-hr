import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { toJSONSchema, type ZodType } from "zod";

import {
  feedbackReviewSchema,
  offerLetterSchema,
  researchSchema,
  screeningSchema,
  slackWelcomeSchema,
  transcriptSummarySchema,
  type FeedbackReviewPayload,
  type OfferLetterPayload,
  type ResearchResultPayload,
  type ScreeningResultPayload,
  type SlackWelcomePayload,
  type TranscriptSummaryPayload,
} from "@/lib/ai/contracts";
import { env, requireValue } from "@/lib/utils/env";

type SourceLink = {
  label: string;
  url: string;
};

type ScreeningInput = {
  candidateName: string;
  roleTitle: string;
  roleSummary: string;
  roleResponsibilities: string[];
  roleRequirements: string[];
  resumeText: string;
  threshold: number;
};

type ResearchInput = {
  fullName: string;
  roleTitle: string;
  linkedinUrl: string;
  portfolioUrl?: string | null;
  resumeSummary: string;
};

type TranscriptInput = {
  candidateName: string;
  roleTitle: string;
  transcriptText: string;
};

type FeedbackInput = {
  roleTitle: string;
  feedbackText: string;
  transcriptSummary: string;
};

type OfferInput = {
  candidateName: string;
  roleTitle: string;
  managerName: string;
  startDate: string;
  baseSalary: string;
  equityBonus?: string | null;
  compensationNotes?: string | null;
  customTerms?: string | null;
};

type SlackWelcomeInput = {
  candidateName: string;
  roleTitle: string;
  startDate: string;
  managerName: string;
};

type StructuredResponseOptions<T> = {
  instructions: string;
  input: string;
  schema: ZodType<T>;
  schemaName: string;
  webSearch?: boolean;
};

function extractMessageText(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (
        item &&
        typeof item === "object" &&
        "text" in item &&
        typeof item.text === "string"
      ) {
        return item.text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function parseStructuredJson<T>(payload: string, schema: ZodType<T>) {
  const normalized = payload
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  return schema.parse(JSON.parse(normalized));
}

function buildOpenRouterInstructions<T>(options: StructuredResponseOptions<T>) {
  return [
    options.instructions,
    "Return one JSON object only. Do not include markdown fences or commentary.",
    `JSON Schema: ${JSON.stringify(toJSONSchema(options.schema))}`,
  ].join("\n\n");
}

function normalizeSources(sources: SourceLink[]) {
  const seen = new Set<string>();

  return sources.filter((source) => {
    if (!source.url || seen.has(source.url)) {
      return false;
    }

    seen.add(source.url);
    return true;
  });
}

type OpenRouterAnnotation = {
  type?: string;
  url_citation?: {
    title?: string;
    url?: string;
  };
};

type OpenRouterCompletion = {
  choices?: Array<{
    message?: {
      content?: unknown;
      annotations?: OpenRouterAnnotation[];
    };
  }>;
};

function extractOpenRouterSources(response: unknown): SourceLink[] {
  const completion = response as OpenRouterCompletion;
  const annotations = completion.choices?.[0]?.message?.annotations ?? [];

  return normalizeSources(
    annotations
      .filter((annotation) => annotation.type === "url_citation" && annotation.url_citation?.url)
      .map((annotation) => ({
        label: annotation.url_citation?.title || "Web result",
        url: annotation.url_citation?.url as string,
      })),
  );
}

export interface AiService {
  screenResume(input: ScreeningInput): Promise<ScreeningResultPayload>;
  researchCandidate(input: ResearchInput): Promise<ResearchResultPayload>;
  summarizeTranscript(input: TranscriptInput): Promise<TranscriptSummaryPayload>;
  reviewFeedback(input: FeedbackInput): Promise<FeedbackReviewPayload>;
  generateOfferLetter(input: OfferInput): Promise<OfferLetterPayload>;
  generateSlackWelcome(input: SlackWelcomeInput): Promise<SlackWelcomePayload>;
}

class OpenAiService implements AiService {
  private readonly client = new OpenAI({
    apiKey: requireValue("OPENAI_API_KEY", env.openAiApiKey),
  });

  private async parseResponse<T>(options: StructuredResponseOptions<T>) {
    const response = await this.client.responses.parse({
      model: env.openAiModel,
      instructions: options.instructions,
      input: options.input,
      text: {
        format: zodTextFormat(options.schema, options.schemaName),
      },
      tools: options.webSearch ? [{ type: "web_search_preview" }] : undefined,
      include: options.webSearch ? ["web_search_call.action.sources"] : undefined,
    });

    if (!response.output_parsed) {
      throw new Error("OpenAI did not return structured output.");
    }

    return {
      parsed: response.output_parsed as T,
      response,
    };
  }

  async screenResume(input: ScreeningInput) {
    const { parsed } = await this.parseResponse({
      instructions:
        "You are an experienced recruiting operator. Score the candidate against the exact role. Be fair, concrete, and evidence-based.",
      input: `Role title: ${input.roleTitle}
Role summary: ${input.roleSummary}
Role responsibilities:
${input.roleResponsibilities.map((item) => `- ${item}`).join("\n")}

Role requirements:
${input.roleRequirements.map((item) => `- ${item}`).join("\n")}

Screening threshold: ${input.threshold}
Candidate name: ${input.candidateName}

Resume:
${input.resumeText}`,
      schema: screeningSchema,
      schemaName: "screening_result",
    });

    return parsed;
  }

  async researchCandidate(input: ResearchInput) {
    const { parsed, response } = await this.parseResponse({
      instructions:
        "You are a hiring research analyst. Use web search only for public information, stay factual, and do not invent evidence. Missing public data is not a negative signal.",
      input: `Candidate: ${input.fullName}
Role: ${input.roleTitle}
LinkedIn URL: ${input.linkedinUrl}
Portfolio or GitHub URL: ${input.portfolioUrl ?? "Not provided"}
Resume summary: ${input.resumeSummary}

Produce a short hiring-manager brief, summarize the public evidence you can validate, call out any discrepancies, and list the sources you actually used.`,
      schema: researchSchema,
      schemaName: "candidate_research",
      webSearch: true,
    });

    const responseWithSources = response as {
      output?: Array<{
        type?: string;
        action?: {
          sources?: Array<{
            title?: string;
            url?: string;
          }>;
        };
      }>;
    };

    const webSources = (responseWithSources.output ?? [])
      .filter((item) => item.type === "web_search_call")
      .flatMap((item) =>
        (item.action?.sources ?? [])
          .filter((source): source is { title?: string; url?: string } => Boolean(source.url))
          .map((source) => ({
            label: source.title || "Web result",
            url: source.url as string,
          })),
      );

    return {
      ...parsed,
      sources: parsed.sources.length > 0 ? parsed.sources : webSources,
    };
  }

  async summarizeTranscript(input: TranscriptInput) {
    const { parsed } = await this.parseResponse({
      instructions:
        "You are an interview ops assistant. Summarize the conversation for a hiring manager in a compact, evidence-based way.",
      input: `Candidate: ${input.candidateName}
Role: ${input.roleTitle}

Transcript:
${input.transcriptText}`,
      schema: transcriptSummarySchema,
      schemaName: "transcript_summary",
    });

    return parsed;
  }

  async reviewFeedback(input: FeedbackInput) {
    const { parsed } = await this.parseResponse({
      instructions:
        "You are a hiring fairness reviewer. Flag vague, biased, or unsupported feedback, and suggest a more evidence-based rewrite.",
      input: `Role: ${input.roleTitle}
Transcript summary: ${input.transcriptSummary}
Feedback:
${input.feedbackText}`,
      schema: feedbackReviewSchema,
      schemaName: "feedback_review",
    });

    return parsed;
  }

  async generateOfferLetter(input: OfferInput) {
    const { parsed } = await this.parseResponse({
      instructions:
        "You draft professional offer letters. Keep the tone warm, clear, and ready for human review. Do not include legal claims you cannot support.",
      input: `Candidate: ${input.candidateName}
Role: ${input.roleTitle}
Manager: ${input.managerName}
Start date: ${input.startDate}
Base salary: ${input.baseSalary}
Equity or bonus: ${input.equityBonus ?? "Not provided"}
Compensation notes: ${input.compensationNotes ?? "None"}
Custom terms: ${input.customTerms ?? "None"}`,
      schema: offerLetterSchema,
      schemaName: "offer_letter",
    });

    return parsed;
  }

  async generateSlackWelcome(input: SlackWelcomeInput) {
    const { parsed } = await this.parseResponse({
      instructions:
        "You write polished onboarding messages for new hires joining Slack. Keep it warm, specific, and concise.",
      input: `Candidate: ${input.candidateName}
Role: ${input.roleTitle}
Start date: ${input.startDate}
Manager: ${input.managerName}`,
      schema: slackWelcomeSchema,
      schemaName: "slack_welcome",
    });

    return parsed;
  }
}

class OpenRouterService implements AiService {
  private readonly client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: requireValue("OPENROUTER_API_KEY", env.openRouterApiKey),
    defaultHeaders: {
      ...(env.openRouterSiteUrl ? { "HTTP-Referer": env.openRouterSiteUrl } : {}),
      ...(env.openRouterAppName ? { "X-OpenRouter-Title": env.openRouterAppName } : {}),
    },
  });

  private async parseResponse<T>(options: StructuredResponseOptions<T>) {
    const completion = await this.client.chat.completions.create({
      model: env.openRouterModel,
      messages: [
        {
          role: "system",
          content: buildOpenRouterInstructions(options),
        },
        {
          role: "user",
          content: options.input,
        },
      ],
      response_format: {
        type: "json_object",
      },
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

    const payload = extractMessageText(completion.choices[0]?.message?.content);

    if (!payload) {
      throw new Error("OpenRouter did not return structured output.");
    }

    return {
      parsed: parseStructuredJson(payload, options.schema),
      sources: extractOpenRouterSources(completion),
    };
  }

  async screenResume(input: ScreeningInput) {
    const { parsed } = await this.parseResponse({
      instructions:
        "You are an experienced recruiting operator. Score the candidate against the exact role. Be fair, concrete, and evidence-based.",
      input: `Role title: ${input.roleTitle}
Role summary: ${input.roleSummary}
Role responsibilities:
${input.roleResponsibilities.map((item) => `- ${item}`).join("\n")}

Role requirements:
${input.roleRequirements.map((item) => `- ${item}`).join("\n")}

Screening threshold: ${input.threshold}
Candidate name: ${input.candidateName}

Resume:
${input.resumeText}`,
      schema: screeningSchema,
      schemaName: "screening_result",
    });

    return parsed;
  }

  async researchCandidate(input: ResearchInput) {
    const { parsed, sources } = await this.parseResponse({
      instructions:
        "You are a hiring research analyst. Use web search only for public information, stay factual, and do not invent evidence. Missing public data is not a negative signal.",
      input: `Candidate: ${input.fullName}
Role: ${input.roleTitle}
LinkedIn URL: ${input.linkedinUrl}
Portfolio or GitHub URL: ${input.portfolioUrl ?? "Not provided"}
Resume summary: ${input.resumeSummary}

Produce a short hiring-manager brief, summarize the public evidence you can validate, call out any discrepancies, and list the sources you actually used.`,
      schema: researchSchema,
      schemaName: "candidate_research",
      webSearch: true,
    });

    return {
      ...parsed,
      sources: parsed.sources.length > 0 ? parsed.sources : sources,
    };
  }

  async summarizeTranscript(input: TranscriptInput) {
    const { parsed } = await this.parseResponse({
      instructions:
        "You are an interview ops assistant. Summarize the conversation for a hiring manager in a compact, evidence-based way.",
      input: `Candidate: ${input.candidateName}
Role: ${input.roleTitle}

Transcript:
${input.transcriptText}`,
      schema: transcriptSummarySchema,
      schemaName: "transcript_summary",
    });

    return parsed;
  }

  async reviewFeedback(input: FeedbackInput) {
    const { parsed } = await this.parseResponse({
      instructions:
        "You are a hiring fairness reviewer. Flag vague, biased, or unsupported feedback, and suggest a more evidence-based rewrite.",
      input: `Role: ${input.roleTitle}
Transcript summary: ${input.transcriptSummary}
Feedback:
${input.feedbackText}`,
      schema: feedbackReviewSchema,
      schemaName: "feedback_review",
    });

    return parsed;
  }

  async generateOfferLetter(input: OfferInput) {
    const { parsed } = await this.parseResponse({
      instructions:
        "You draft professional offer letters. Keep the tone warm, clear, and ready for human review. Do not include legal claims you cannot support.",
      input: `Candidate: ${input.candidateName}
Role: ${input.roleTitle}
Manager: ${input.managerName}
Start date: ${input.startDate}
Base salary: ${input.baseSalary}
Equity or bonus: ${input.equityBonus ?? "Not provided"}
Compensation notes: ${input.compensationNotes ?? "None"}
Custom terms: ${input.customTerms ?? "None"}`,
      schema: offerLetterSchema,
      schemaName: "offer_letter",
    });

    return parsed;
  }

  async generateSlackWelcome(input: SlackWelcomeInput) {
    const { parsed } = await this.parseResponse({
      instructions:
        "You write polished onboarding messages for new hires joining Slack. Keep it warm, specific, and concise.",
      input: `Candidate: ${input.candidateName}
Role: ${input.roleTitle}
Start date: ${input.startDate}
Manager: ${input.managerName}`,
      schema: slackWelcomeSchema,
      schemaName: "slack_welcome",
    });

    return parsed;
  }
}

function hasConfiguredKey(value: string) {
  return value.trim().length > 0;
}

export function getAiService(): AiService {
  const hasOpenRouterKey = hasConfiguredKey(env.openRouterApiKey);
  const hasOpenAiKey = hasConfiguredKey(env.openAiApiKey);

  if (env.aiProvider === "openrouter") {
    if (!hasOpenRouterKey) {
      throw new Error("AI_PROVIDER is set to openrouter but OPENROUTER_API_KEY is missing.");
    }

    return new OpenRouterService();
  }

  if (env.aiProvider === "openai") {
    if (!hasOpenAiKey) {
      throw new Error("AI_PROVIDER is set to openai but OPENAI_API_KEY is missing.");
    }

    return new OpenAiService();
  }

  if (hasOpenRouterKey) {
    return new OpenRouterService();
  }

  if (hasOpenAiKey) {
    return new OpenAiService();
  }

  throw new Error("No AI provider is configured. Set OPENROUTER_API_KEY or OPENAI_API_KEY.");
}
