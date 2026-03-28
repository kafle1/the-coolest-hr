import { randomUUID } from "node:crypto";

import { createSessionToken, verifySessionToken } from "@/lib/auth/session-token";
import { env, requireValue } from "@/lib/utils/env";

const SLACK_OPENID_AUTHORIZE_URL = "https://slack.com/openid/connect/authorize";
const SLACK_OPENID_TOKEN_URL = "https://slack.com/api/openid.connect.token";
const SLACK_OPENID_USERINFO_URL = "https://slack.com/api/openid.connect.userInfo";
const SLACK_OPENID_SCOPES = ["openid", "profile", "email"];
const SLACK_CONNECT_STATE_PREFIX = "slack-connect";

type SlackIdTokenPayload = {
  aud?: string | string[];
  iss?: string;
  nonce?: string;
  sub?: string;
  "https://slack.com/team_id"?: string;
  "https://slack.com/user_id"?: string;
};

type SlackOpenIdTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
  id_token?: string;
  ok?: boolean;
};

type SlackOpenIdUserInfoResponse = {
  email?: string;
  error?: string;
  name?: string;
  ok?: boolean;
  sub?: string;
  "https://slack.com/team_id"?: string;
  "https://slack.com/user_id"?: string;
};

export type SlackConnectIdentity = {
  email: string;
  slackUserId: string;
  teamId?: string;
};

function normalizeUrl(value: string) {
  return value.replace(/\/$/, "");
}

function parseSlackConnectStateValue(value: string) {
  const match = new RegExp(`^${SLACK_CONNECT_STATE_PREFIX}:([^:]+):(.+)$`).exec(value);

  if (!match) {
    return null;
  }

  return {
    offerToken: match[1],
    nonce: match[2],
  };
}

function decodeJwtPayload(token: string) {
  const [, payload] = token.split(".");

  if (!payload) {
    throw new Error("Slack returned an invalid ID token.");
  }

  const normalizedPayload = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalizedPayload.length % 4;
  const paddedPayload =
    padding === 0 ? normalizedPayload : normalizedPayload.padEnd(normalizedPayload.length + (4 - padding), "=");

  return JSON.parse(Buffer.from(paddedPayload, "base64").toString("utf8")) as SlackIdTokenPayload;
}

function readSlackApiError(input: {
  payload?: { error?: string; error_description?: string; ok?: boolean };
  status: number;
}) {
  if (input.payload?.error_description?.trim()) {
    return input.payload.error_description.trim();
  }

  if (input.payload?.error?.trim()) {
    return input.payload.error.trim();
  }

  return `Slack returned HTTP ${input.status}.`;
}

export function canUseSlackCandidateConnect() {
  return Boolean(env.slackClientId && env.slackClientSecret);
}

export function getSlackOAuthRedirectUri() {
  return `${normalizeUrl(env.appUrl)}/api/integrations/slack/connect/callback`;
}

export function getSlackCandidateConnectStartUrl(offerToken: string) {
  const url = new URL(`${normalizeUrl(env.appUrl)}/api/integrations/slack/connect`);
  url.searchParams.set("offer", offerToken);

  return url.toString();
}

export async function createSlackConnectState(offerToken: string) {
  const nonce = randomUUID();
  const state = await createSessionToken(
    `${SLACK_CONNECT_STATE_PREFIX}:${offerToken}:${nonce}`,
  );

  return {
    nonce,
    state,
  };
}

export async function verifySlackConnectState(state: string) {
  const value = await verifySessionToken(state);

  if (!value) {
    return null;
  }

  return parseSlackConnectStateValue(value);
}

export function buildSlackConnectUrl(input: { state: string; nonce: string }) {
  const url = new URL(SLACK_OPENID_AUTHORIZE_URL);

  url.searchParams.set("client_id", requireValue("SLACK_CLIENT_ID", env.slackClientId));
  url.searchParams.set("redirect_uri", getSlackOAuthRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "form_post");
  url.searchParams.set("scope", SLACK_OPENID_SCOPES.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);

  if (env.slackTeamId.trim()) {
    url.searchParams.set("team", env.slackTeamId.trim());
  }

  return url.toString();
}

export async function exchangeSlackConnectCode(code: string) {
  const response = await fetch(SLACK_OPENID_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: requireValue("SLACK_CLIENT_ID", env.slackClientId),
      client_secret: requireValue("SLACK_CLIENT_SECRET", env.slackClientSecret),
      code,
      grant_type: "authorization_code",
      redirect_uri: getSlackOAuthRedirectUri(),
    }),
  });

  const payload = (await response.json()) as SlackOpenIdTokenResponse;

  if (!response.ok || payload.ok === false) {
    throw new Error(readSlackApiError({ payload, status: response.status }));
  }

  if (!payload.access_token || !payload.id_token) {
    throw new Error("Slack did not return the required OpenID tokens.");
  }

  return {
    accessToken: payload.access_token,
    idToken: payload.id_token,
  };
}

export function verifySlackIdToken(input: { idToken: string; expectedNonce: string }) {
  const payload = decodeJwtPayload(input.idToken);
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud].filter(Boolean);

  if (payload.iss !== "https://slack.com") {
    throw new Error("Slack returned an ID token with an unexpected issuer.");
  }

  if (!audience.includes(requireValue("SLACK_CLIENT_ID", env.slackClientId))) {
    throw new Error("Slack returned an ID token for the wrong client.");
  }

  if (payload.nonce !== input.expectedNonce) {
    throw new Error("Slack returned an ID token with an invalid nonce.");
  }

  if (env.slackTeamId.trim()) {
    const teamId = payload["https://slack.com/team_id"]?.trim();

    if (teamId && teamId !== env.slackTeamId.trim()) {
      throw new Error("Slack connected the candidate to the wrong workspace.");
    }
  }

  return payload;
}

export async function fetchSlackConnectIdentity(accessToken: string) {
  const response = await fetch(SLACK_OPENID_USERINFO_URL, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const payload = (await response.json()) as SlackOpenIdUserInfoResponse;

  if (!response.ok || payload.ok === false) {
    throw new Error(readSlackApiError({ payload, status: response.status }));
  }

  const email = payload.email?.trim().toLowerCase();
  const slackUserId = payload["https://slack.com/user_id"]?.trim();

  if (!email || !slackUserId) {
    throw new Error("Slack did not return the candidate email or Slack user ID.");
  }

  return {
    email,
    slackUserId,
    teamId: payload["https://slack.com/team_id"]?.trim() || undefined,
  } satisfies SlackConnectIdentity;
}
