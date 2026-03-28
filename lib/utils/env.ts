import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";

type GoogleServiceAccountFile = {
  type?: string;
  client_email?: string;
  private_key?: string;
};

function readNumber(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const supportedAiProviders = ["auto", "openai", "openrouter"] as const;
const supportedGoogleCalendarAuthModes = ["service-account", "gcloud-user"] as const;

type SupportedAiProvider = (typeof supportedAiProviders)[number];
type SupportedGoogleCalendarAuthMode = (typeof supportedGoogleCalendarAuthModes)[number];

function readFirstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0);
}

function parseGoogleServiceAccountPayload(payload: string) {
  try {
    const parsed = JSON.parse(payload) as GoogleServiceAccountFile;

    if (
      parsed.type !== "service_account" ||
      !parsed.client_email?.trim() ||
      !parsed.private_key?.trim()
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function readGoogleServiceAccountFromFile(filePath: string | undefined) {
  if (!filePath) {
    return null;
  }

  const normalizedPath = isAbsolute(filePath) ? filePath : join(process.cwd(), filePath);

  if (!existsSync(normalizedPath)) {
    return null;
  }

  try {
    return parseGoogleServiceAccountPayload(readFileSync(normalizedPath, "utf8"));
  } catch {
    return null;
  }
}

function discoverGoogleServiceAccountFromWorkspace() {
  if (process.env.NODE_ENV === "test") {
    return null;
  }

  try {
    const rootJsonFiles = readdirSync(process.cwd(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => join(process.cwd(), entry.name));

    for (const filePath of rootJsonFiles) {
      const credentials = readGoogleServiceAccountFromFile(filePath);

      if (credentials) {
        return credentials;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function resolveGoogleServiceAccount() {
  const inlineServiceAccount = readFirstNonEmpty(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const parsedInlineServiceAccount = inlineServiceAccount
    ? parseGoogleServiceAccountPayload(inlineServiceAccount)
    : null;

  if (parsedInlineServiceAccount) {
    return parsedInlineServiceAccount;
  }

  const configuredFile = readFirstNonEmpty(
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
  );
  const serviceAccountFromFile = readGoogleServiceAccountFromFile(configuredFile);

  if (serviceAccountFromFile) {
    return serviceAccountFromFile;
  }

  return discoverGoogleServiceAccountFromWorkspace();
}

const googleServiceAccount = resolveGoogleServiceAccount();

function readAiProvider(value: string | undefined): SupportedAiProvider {
  if (!value) {
    return "auto";
  }

  const normalized = value.trim().toLowerCase();

  if (supportedAiProviders.includes(normalized as SupportedAiProvider)) {
    return normalized as SupportedAiProvider;
  }

  return "auto";
}

function readGoogleCalendarAuthMode(
  value: string | undefined,
): SupportedGoogleCalendarAuthMode {
  if (!value) {
    return "service-account";
  }

  const normalized = value.trim().toLowerCase();

  if (
    supportedGoogleCalendarAuthModes.includes(
      normalized as SupportedGoogleCalendarAuthMode,
    )
  ) {
    return normalized as SupportedGoogleCalendarAuthMode;
  }

  return "service-account";
}

export const env = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  screeningThreshold: readNumber(process.env.SCREENING_THRESHOLD, 76),
  aiProvider: readAiProvider(process.env.AI_PROVIDER),
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openRouterModel: process.env.OPENROUTER_MODEL ?? "openai/gpt-4.1-mini",
  openRouterSiteUrl: process.env.OPENROUTER_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "",
  openRouterAppName: process.env.OPENROUTER_APP_NAME ?? "Niural Candidate Onboarding System",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  resendFromEmail: process.env.RESEND_FROM_EMAIL ?? "Niural Hiring <onboarding@niural.com>",
  resendFallbackFromEmail:
    process.env.RESEND_FALLBACK_FROM_EMAIL ?? "Niural Hiring <onboarding@resend.dev>",
  googleCalendarAuthMode: readGoogleCalendarAuthMode(
    process.env.GOOGLE_CALENDAR_AUTH_MODE,
  ),
  googleServiceAccountEmail:
    readFirstNonEmpty(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      googleServiceAccount?.client_email,
    ) ?? "",
  googleServiceAccountPrivateKey:
    readFirstNonEmpty(
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      googleServiceAccount?.private_key,
    ) ?? "",
  googleCalendarId: process.env.GOOGLE_CALENDAR_ID ?? "",
  gcloudConfigDir:
    process.env.GCLOUD_CONFIG_DIR?.trim() ??
    (process.env.HOME ? join(process.env.HOME, ".config", "gcloud") : ""),
  interviewerName: process.env.INTERVIEWER_NAME ?? "Jordan Lee",
  interviewerEmail: process.env.INTERVIEWER_EMAIL ?? "jordan.lee@example.com",
  slackBotToken: process.env.SLACK_BOT_TOKEN ?? "",
  slackAdminUserToken: process.env.SLACK_ADMIN_USER_TOKEN ?? "",
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET ?? "",
  slackHrChannelId: process.env.SLACK_HR_CHANNEL_ID ?? "",
  slackTeamId: process.env.SLACK_TEAM_ID ?? "",
  slackDefaultChannelIds: (process.env.SLACK_DEFAULT_CHANNEL_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  firefliesApiKey: process.env.FIREFLIES_API_KEY ?? "",
  adminEmail: process.env.ADMIN_EMAIL?.trim() ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
};

export function requireValue(name: string, value: string) {
  if (!value) {
    throw new Error(`${name} is required for real integration mode.`);
  }

  return value;
}
