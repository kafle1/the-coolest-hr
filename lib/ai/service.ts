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
  operationLabel: string;
  timeoutMs?: number;
  webSearch?: boolean;
};

const DEFAULT_AI_REQUEST_TIMEOUT_MS = 45_000;
const SCREENING_TIMEOUT_MS = 90_000;
const RESEARCH_TIMEOUT_MS = 90_000;
const JSON_REPAIR_TIMEOUT_MS = 10_000;
const SCREENING_RESUME_TEXT_LIMIT = 2_500;
const RESEARCH_SUMMARY_TEXT_LIMIT = 1_600;
const OPENROUTER_FREE_MODEL_COOLDOWN_MS = 8_000;
const OPENROUTER_RATE_LIMIT_RETRY_DELAYS_MS = [10_000, 20_000, 30_000] as const;

const providerCooldownUntil = new Map<string, number>();
const providerQueues = new Map<string, Promise<void>>();

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

async function withAiRequestTimeout<T>(
  operationLabel: string,
  operation: () => Promise<T>,
  timeoutMs = DEFAULT_AI_REQUEST_TIMEOUT_MS,
) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          `${operationLabel} timed out after ${Math.floor(
            timeoutMs / 1000,
          )} seconds.`,
        ),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(), timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function normalizeTextBlock(value: string) {
  return value
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateTextBlock(value: string, limit: number, marker: string) {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit).trimEnd()}\n\n${marker}`;
}

function prepareResumeTextForScreening(resumeText: string, limit: number) {
  const normalized = normalizeTextBlock(resumeText);

  return truncateTextBlock(
    normalized,
    limit,
    "[resume truncated for screening]",
  );
}

function prepareResumeSummaryForResearch(resumeSummary: string, limit: number) {
  const normalized = normalizeTextBlock(resumeSummary);

  return truncateTextBlock(
    normalized,
    limit,
    "[resume summary truncated for research]",
  );
}

function formatAiLogValue(value: string) {
  return value.replaceAll("\"", "'");
}

function writeAiLog(
  provider: "openai" | "openrouter",
  operationLabel: string,
  note: string,
  level: "info" | "error" = "info",
) {
  const message = `[hiring-os] ${new Date().toISOString()} ai="${operationLabel}" provider="${provider}" ${note}`;

  if (level === "error") {
    console.error(message);
    return;
  }

  console.info(message);
}

function sleep(durationMs: number) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function getProviderQueueKey(provider: "openai" | "openrouter", model: string) {
  return `${provider}:${model}`;
}

function readHeaderValue(
  headers: unknown,
  name: string,
): string | null {
  if (!headers || typeof headers !== "object") {
    return null;
  }

  if ("get" in headers && typeof headers.get === "function") {
    const value = headers.get(name);
    return typeof value === "string" ? value : null;
  }

  const record = headers as Record<string, unknown>;
  const direct = record[name];

  if (typeof direct === "string") {
    return direct;
  }

  const normalizedKey = Object.keys(record).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );

  if (!normalizedKey) {
    return null;
  }

  const normalizedValue = record[normalizedKey];
  return typeof normalizedValue === "string" ? normalizedValue : null;
}

function isRateLimitError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const status = "status" in error ? error.status : undefined;
  if (typeof status === "number" && status === 429) {
    return true;
  }

  const message = "message" in error ? error.message : undefined;
  return (
    typeof message === "string" &&
    (/(\b429\b)/.test(message) || /rate limit/i.test(message))
  );
}

function getRateLimitDelayMs(error: unknown, retryIndex: number) {
  const headers = error && typeof error === "object" && "headers" in error ? error.headers : null;
  const retryAfterMs = readHeaderValue(headers, "retry-after-ms");

  if (retryAfterMs) {
    const parsed = Number.parseFloat(retryAfterMs);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  const retryAfter = readHeaderValue(headers, "retry-after");
  if (retryAfter) {
    const parsedSeconds = Number.parseFloat(retryAfter);

    if (Number.isFinite(parsedSeconds) && parsedSeconds >= 0) {
      return parsedSeconds * 1000;
    }

    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.max(0, retryAt - Date.now());
    }
  }

  return OPENROUTER_RATE_LIMIT_RETRY_DELAYS_MS[
    Math.min(retryIndex, OPENROUTER_RATE_LIMIT_RETRY_DELAYS_MS.length - 1)
  ];
}

async function runSerializedProviderRequest<T>(
  provider: "openai" | "openrouter",
  model: string,
  operation: () => Promise<T>,
) {
  const key = getProviderQueueKey(provider, model);
  const previous = providerQueues.get(key) ?? Promise.resolve();
  let releaseQueue: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  providerQueues.set(
    key,
    previous.catch(() => undefined).then(() => current),
  );

  await previous.catch(() => undefined);

  try {
    const cooldownUntil = providerCooldownUntil.get(key) ?? 0;
    const waitDurationMs = cooldownUntil - Date.now();

    if (waitDurationMs > 0) {
      await sleep(waitDurationMs);
    }

    return await operation();
  } finally {
    releaseQueue?.();

    if (providerQueues.get(key) === current) {
      providerQueues.delete(key);
    }
  }
}

function setProviderCooldown(
  provider: "openai" | "openrouter",
  model: string,
  delayMs: number,
) {
  const key = getProviderQueueKey(provider, model);
  const nextAllowedAt = Date.now() + Math.max(0, delayMs);
  const existing = providerCooldownUntil.get(key) ?? 0;
  providerCooldownUntil.set(key, Math.max(existing, nextAllowedAt));
}

function formatBulletList(items: string[], maxItems: number) {
  const selectedItems = items
    .map((item) => normalizeTextBlock(item))
    .filter(Boolean)
    .slice(0, maxItems);

  if (selectedItems.length === 0) {
    return "- None provided";
  }

  return selectedItems.map((item) => `- ${item}`).join("\n");
}

function buildScreeningPrompt(input: ScreeningInput) {
  const resumeText = prepareResumeTextForScreening(
    input.resumeText,
    SCREENING_RESUME_TEXT_LIMIT,
  );

  return `Role title: ${input.roleTitle}
Role summary: ${normalizeTextBlock(input.roleSummary)}
Role responsibilities:
${formatBulletList(input.roleResponsibilities, 5)}

Role requirements:
${formatBulletList(input.roleRequirements, 6)}

Screening threshold: ${input.threshold}
Candidate name: ${input.candidateName}

Resume:
${resumeText}`;
}

function buildResearchPrompt(input: ResearchInput) {
  const resumeSummary = prepareResumeSummaryForResearch(
    input.resumeSummary,
    RESEARCH_SUMMARY_TEXT_LIMIT,
  );

  return `Candidate: ${input.fullName}
Role: ${input.roleTitle}
LinkedIn URL: ${input.linkedinUrl}
Portfolio or GitHub URL: ${input.portfolioUrl ?? "Not provided"}
Resume summary:
${resumeSummary}

Produce a short hiring-manager brief, summarize the public evidence you can validate, call out any discrepancies, and list the sources you actually used.`;
}

export function parseStructuredJson<T>(payload: string, schema: ZodType<T>) {
  const normalized = normalizeStructuredPayload(payload);
  const candidates = new Set<string>([
    normalized,
    extractJsonObject(normalized),
    repairJsonStringLiterals(normalized),
    repairJsonStringLiterals(extractJsonObject(normalized)),
  ]);
  let lastError: unknown = null;

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      return schema.parse(JSON.parse(removeTrailingCommas(candidate)));
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unable to parse structured JSON.");
}

function normalizeStructuredPayload(payload: string) {
  return payload
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
}

function extractJsonObject(payload: string) {
  const start = payload.indexOf("{");

  if (start < 0) {
    return payload;
  }

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = start; index < payload.length; index += 1) {
    const character = payload[index];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (character === "\\") {
      escaping = true;
      continue;
    }

    if (character === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return payload.slice(start, index + 1);
      }
    }
  }

  return payload.slice(start);
}

function repairJsonStringLiterals(payload: string) {
  let result = "";
  let inString = false;
  let escaping = false;

  for (const character of payload) {
    if (escaping) {
      result += character;
      escaping = false;
      continue;
    }

    if (character === "\\") {
      result += character;
      escaping = true;
      continue;
    }

    if (character === "\"") {
      result += character;
      inString = !inString;
      continue;
    }

    if (inString) {
      if (character === "\n") {
        result += "\\n";
        continue;
      }

      if (character === "\r") {
        result += "\\r";
        continue;
      }

      if (character === "\t") {
        result += "\\t";
        continue;
      }
    }

    result += character;
  }

  return result;
}

function removeTrailingCommas(payload: string) {
  return payload.replace(/,\s*([}\]])/g, "$1");
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

function normalizeStringList(value: string[] | string | null | undefined) {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean);
  }

  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(/\n+|,\s*/)
    .map((item) => item.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean);
}

function normalizeOptionalString(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeEducation(
  value:
    | {
        highestDegree?: string;
        focus?: string;
      }
    | null
    | undefined,
) {
  const highestDegree = value?.highestDegree?.trim();
  const focus = value?.focus?.trim();

  if (!highestDegree && !focus) {
    return null;
  }

  return {
    highestDegree: highestDegree || "Not specified",
    focus: focus || "Not specified",
  };
}

function normalizeScreeningResult(
  parsed: {
    score: number;
    summary: string;
    strengths?: string[] | string | null;
    gaps?: string[] | string | null;
    parsedSkills?: string[] | string | null;
    yearsExperience?: number | null;
    education?: {
      highestDegree?: string;
      focus?: string;
    } | null;
    pastEmployers?: string[] | string | null;
    achievements?: string[] | string | null;
  },
): ScreeningResultPayload {
  return {
    score: parsed.score,
    summary: parsed.summary.trim(),
    strengths: normalizeStringList(parsed.strengths),
    gaps: normalizeStringList(parsed.gaps),
    parsedSkills: normalizeStringList(parsed.parsedSkills),
    yearsExperience: parsed.yearsExperience ?? null,
    education: normalizeEducation(parsed.education),
    pastEmployers: normalizeStringList(parsed.pastEmployers),
    achievements: normalizeStringList(parsed.achievements),
  };
}

function normalizeResearchResult(parsed: {
  brief: string;
  linkedinSummary?: string | null;
  xSummary?: string | null;
  githubSummary?: string | null;
  portfolioSummary?: string | null;
  discrepancies?: string[] | string | null;
  limitations?: string[] | string | null;
  sources?: SourceLink[];
}): ResearchResultPayload {
  return {
    brief: parsed.brief.trim(),
    linkedinSummary: normalizeOptionalString(parsed.linkedinSummary),
    xSummary: normalizeOptionalString(parsed.xSummary),
    githubSummary: normalizeOptionalString(parsed.githubSummary),
    portfolioSummary: normalizeOptionalString(parsed.portfolioSummary),
    discrepancies: normalizeStringList(parsed.discrepancies),
    limitations: normalizeStringList(parsed.limitations),
    sources: normalizeSources(parsed.sources ?? []),
  };
}

function normalizeTranscriptSummary(parsed: {
  summary: string;
  bulletPoints?: string[] | string | null;
}): TranscriptSummaryPayload {
  return {
    summary: parsed.summary.trim(),
    bulletPoints: normalizeStringList(parsed.bulletPoints),
  };
}

function normalizeFeedbackReview(parsed: {
  requiresAttention: boolean;
  flaggedPhrases?: string[] | string | null;
  rewriteSuggestion: string;
  reasoning: string;
}): FeedbackReviewPayload {
  return {
    requiresAttention: parsed.requiresAttention,
    flaggedPhrases: normalizeStringList(parsed.flaggedPhrases),
    rewriteSuggestion: parsed.rewriteSuggestion.trim(),
    reasoning: parsed.reasoning.trim(),
  };
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
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? DEFAULT_AI_REQUEST_TIMEOUT_MS;

    writeAiLog(
      "openai",
      options.operationLabel,
      `started model="${formatAiLogValue(env.openAiModel)}" timeoutMs=${timeoutMs} inputChars=${options.input.length}`,
    );

    try {
      const response = await withAiRequestTimeout(
        options.operationLabel,
        () =>
          this.client.responses.parse({
            model: env.openAiModel,
            instructions: options.instructions,
            input: options.input,
            text: {
              format: zodTextFormat(options.schema, options.schemaName),
            },
            tools: options.webSearch ? [{ type: "web_search_preview" }] : undefined,
            include: options.webSearch ? ["web_search_call.action.sources"] : undefined,
          }),
        timeoutMs,
      );

      if (!response.output_parsed) {
        throw new Error("OpenAI did not return structured output.");
      }

      writeAiLog(
        "openai",
        options.operationLabel,
        `completed model="${formatAiLogValue(env.openAiModel)}" durationMs=${Date.now() - startedAt}`,
      );

      return {
        parsed: response.output_parsed as T,
        response,
      };
    } catch (error) {
      writeAiLog(
        "openai",
        options.operationLabel,
        `failed model="${formatAiLogValue(env.openAiModel)}" durationMs=${Date.now() - startedAt} message="${formatAiLogValue(error instanceof Error ? error.message : "Unknown AI error.")}"`,
        "error",
      );
      throw error;
    }
  }

  async screenResume(input: ScreeningInput) {
    const { parsed } = await this.parseResponse({
      operationLabel: "AI screening",
      timeoutMs: SCREENING_TIMEOUT_MS,
      instructions:
        "You are an experienced recruiting operator. Score the candidate against the exact role. Be concrete, evidence-based, and concise. Keep the summary to two sentences max and each list to at most five short items. Do not quote or restate the resume.",
      input: buildScreeningPrompt(input),
      schema: screeningSchema,
      schemaName: "screening_result",
    });

    return normalizeScreeningResult(parsed);
  }

  async researchCandidate(input: ResearchInput) {
    const { parsed, response } = await this.parseResponse({
      operationLabel: "Candidate research",
      timeoutMs: RESEARCH_TIMEOUT_MS,
      instructions:
        "You are a hiring research analyst. Use web search only for public information, stay factual, and do not invent evidence. Missing public data is not a negative signal.",
      input: buildResearchPrompt(input),
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

    return normalizeResearchResult({
      ...parsed,
      sources: parsed.sources.length > 0 ? parsed.sources : webSources,
    });
  }

  async summarizeTranscript(input: TranscriptInput) {
    const { parsed } = await this.parseResponse({
      operationLabel: "Transcript summarization",
      instructions:
        "You are an interview ops assistant. Summarize the conversation for a hiring manager in a compact, evidence-based way.",
      input: `Candidate: ${input.candidateName}
Role: ${input.roleTitle}

Transcript:
${input.transcriptText}`,
      schema: transcriptSummarySchema,
      schemaName: "transcript_summary",
    });

    return normalizeTranscriptSummary(parsed);
  }

  async reviewFeedback(input: FeedbackInput) {
    const { parsed } = await this.parseResponse({
      operationLabel: "Feedback review",
      instructions:
        "You are a hiring fairness reviewer. Flag vague, biased, or unsupported feedback, and suggest a more evidence-based rewrite.",
      input: `Role: ${input.roleTitle}
Transcript summary: ${input.transcriptSummary}
Feedback:
${input.feedbackText}`,
      schema: feedbackReviewSchema,
      schemaName: "feedback_review",
    });

    return normalizeFeedbackReview(parsed);
  }

  async generateOfferLetter(input: OfferInput) {
    const { parsed } = await this.parseResponse({
      operationLabel: "Offer generation",
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
      operationLabel: "Slack welcome generation",
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
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? DEFAULT_AI_REQUEST_TIMEOUT_MS;
    const model = env.openRouterModel;

    writeAiLog(
      "openrouter",
      options.operationLabel,
      `started model="${formatAiLogValue(model)}" timeoutMs=${timeoutMs} inputChars=${options.input.length}`,
    );

    for (let retryIndex = 0; ; retryIndex += 1) {
      try {
        const completion = await runSerializedProviderRequest(
          "openrouter",
          model,
          async () =>
            withAiRequestTimeout(
              options.operationLabel,
              () =>
                this.client.chat.completions.create({
                  model,
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
                  temperature: 0,
                } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming),
              timeoutMs,
            ),
        );

        const payload = extractMessageText(completion.choices[0]?.message?.content);

        if (!payload) {
          throw new Error("OpenRouter did not return structured output.");
        }

        const parsed = await this.parseStructuredPayload(options, payload);

        if (model.endsWith(":free")) {
          setProviderCooldown(
            "openrouter",
            model,
            OPENROUTER_FREE_MODEL_COOLDOWN_MS,
          );
        }

        writeAiLog(
          "openrouter",
          options.operationLabel,
          `completed model="${formatAiLogValue(model)}" durationMs=${Date.now() - startedAt} outputChars=${payload.length}`,
        );

        return {
          parsed,
          sources: extractOpenRouterSources(completion),
        };
      } catch (error) {
        if (
          isRateLimitError(error) &&
          retryIndex < OPENROUTER_RATE_LIMIT_RETRY_DELAYS_MS.length
        ) {
          const retryDelayMs = getRateLimitDelayMs(error, retryIndex);
          setProviderCooldown("openrouter", model, retryDelayMs);
          writeAiLog(
            "openrouter",
            options.operationLabel,
            `rate_limited model="${formatAiLogValue(model)}" retryInMs=${Math.round(retryDelayMs)} retryAttempt=${retryIndex + 1}`,
            "error",
          );
          continue;
        }

        writeAiLog(
          "openrouter",
          options.operationLabel,
          `failed model="${formatAiLogValue(model)}" durationMs=${Date.now() - startedAt} message="${formatAiLogValue(error instanceof Error ? error.message : "Unknown AI error.")}"`,
          "error",
        );
        throw error;
      }
    }
  }

  private async parseStructuredPayload<T>(
    options: StructuredResponseOptions<T>,
    payload: string,
  ) {
    try {
      return parseStructuredJson(payload, options.schema);
    } catch (error) {
      const repairOperationLabel = `${options.operationLabel} JSON repair`;
      const repairTimeoutMs = Math.min(
        options.timeoutMs ?? DEFAULT_AI_REQUEST_TIMEOUT_MS,
        JSON_REPAIR_TIMEOUT_MS,
      );

      writeAiLog(
        "openrouter",
        repairOperationLabel,
        `started model="${formatAiLogValue(env.openRouterModel)}" timeoutMs=${repairTimeoutMs} inputChars=${payload.length}`,
      );

      try {
        const repairCompletion = await withAiRequestTimeout(
          repairOperationLabel,
          () =>
            this.client.chat.completions.create({
              model: env.openRouterModel,
              messages: [
                {
                  role: "system",
                  content: [
                    "You repair malformed JSON.",
                    "Return one valid JSON object only.",
                    "Preserve the original meaning.",
                    `JSON Schema: ${JSON.stringify(toJSONSchema(options.schema))}`,
                  ].join("\n\n"),
                },
                {
                  role: "user",
                  content: `Repair this malformed JSON so it matches the schema exactly:\n\n${payload}`,
                },
              ],
              response_format: {
                type: "json_object",
              },
              temperature: 0,
            } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming),
          repairTimeoutMs,
        );

        const repairedPayload = extractMessageText(
          repairCompletion.choices[0]?.message?.content,
        );

        if (!repairedPayload) {
          throw error;
        }

        const repairedResult = parseStructuredJson(repairedPayload, options.schema);

        writeAiLog(
          "openrouter",
          repairOperationLabel,
          `completed model="${formatAiLogValue(env.openRouterModel)}" outputChars=${repairedPayload.length}`,
        );

        return repairedResult;
      } catch (repairError) {
        writeAiLog(
          "openrouter",
          repairOperationLabel,
          `failed model="${formatAiLogValue(env.openRouterModel)}" message="${formatAiLogValue(repairError instanceof Error ? repairError.message : "Unknown AI error.")}"`,
          "error",
        );
        throw error;
      }
    }
  }

  async screenResume(input: ScreeningInput) {
    const { parsed } = await this.parseResponse({
      operationLabel: "AI screening",
      timeoutMs: SCREENING_TIMEOUT_MS,
      instructions:
        "You are an experienced recruiting operator. Score the candidate against the exact role. Be concrete, evidence-based, and concise. Keep the summary to two sentences max and each list to at most five short items. Do not quote or restate the resume.",
      input: buildScreeningPrompt(input),
      schema: screeningSchema,
      schemaName: "screening_result",
    });

    return normalizeScreeningResult(parsed);
  }

  async researchCandidate(input: ResearchInput) {
    const { parsed, sources } = await this.parseResponse({
      operationLabel: "Candidate research",
      timeoutMs: RESEARCH_TIMEOUT_MS,
      instructions:
        "You are a hiring research analyst. Use web search only for public information, stay factual, and do not invent evidence. Missing public data is not a negative signal.",
      input: buildResearchPrompt(input),
      schema: researchSchema,
      schemaName: "candidate_research",
      webSearch: true,
    });

    return normalizeResearchResult({
      ...parsed,
      sources: parsed.sources.length > 0 ? parsed.sources : sources,
    });
  }

  async summarizeTranscript(input: TranscriptInput) {
    const { parsed } = await this.parseResponse({
      operationLabel: "Transcript summarization",
      instructions:
        "You are an interview ops assistant. Summarize the conversation for a hiring manager in a compact, evidence-based way.",
      input: `Candidate: ${input.candidateName}
Role: ${input.roleTitle}

Transcript:
${input.transcriptText}`,
      schema: transcriptSummarySchema,
      schemaName: "transcript_summary",
    });

    return normalizeTranscriptSummary(parsed);
  }

  async reviewFeedback(input: FeedbackInput) {
    const { parsed } = await this.parseResponse({
      operationLabel: "Feedback review",
      instructions:
        "You are a hiring fairness reviewer. Flag vague, biased, or unsupported feedback, and suggest a more evidence-based rewrite.",
      input: `Role: ${input.roleTitle}
Transcript summary: ${input.transcriptSummary}
Feedback:
${input.feedbackText}`,
      schema: feedbackReviewSchema,
      schemaName: "feedback_review",
    });

    return normalizeFeedbackReview(parsed);
  }

  async generateOfferLetter(input: OfferInput) {
    const { parsed } = await this.parseResponse({
      operationLabel: "Offer generation",
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
      operationLabel: "Slack welcome generation",
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
