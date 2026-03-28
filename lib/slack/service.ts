import { createHmac, timingSafeEqual } from "node:crypto";

import { WebClient } from "@slack/web-api";

import { env } from "@/lib/utils/env";

export interface SlackService {
  inviteCandidate(input: { email: string; channelIds?: string[] }): Promise<{ externalId: string }>;
  sendDirectMessage(input: { slackUserId: string; text: string }): Promise<void>;
  notifyHr(input: { text: string }): Promise<void>;
  getUserEmail(slackUserId: string): Promise<string | null>;
  verifyRequestSignature(input: {
    rawBody: string;
    timestamp: string;
    signature: string;
  }): boolean;
}

function isFreshSlackTimestamp(timestamp: string) {
  const parsedTimestamp = Number(timestamp);

  if (!Number.isFinite(parsedTimestamp)) {
    return false;
  }

  return Math.abs(Math.floor(Date.now() / 1000) - parsedTimestamp) <= 5 * 60;
}

function safelyCompareSlackSignatures(expectedSignature: string, actualSignature: string) {
  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(actualSignature);

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function readSlackErrorCode(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof (error as { data?: { error?: unknown } }).data?.error === "string"
  ) {
    return (error as { data: { error: string } }).data.error;
  }

  return null;
}

class LocalSlackService implements SlackService {
  async inviteCandidate(input: { email: string }) {
    console.warn(`[LocalSlackService] Would invite ${input.email} to Slack`);
    return {
      externalId: `local-invite-${input.email}`,
    };
  }

  async sendDirectMessage(input: { slackUserId: string; text: string }) {
    console.warn(`[LocalSlackService] Would send DM to ${input.slackUserId}: ${input.text}`);
  }

  async notifyHr(input: { text: string }) {
    console.warn(`[LocalSlackService] Would notify HR: ${input.text}`);
  }

  async getUserEmail() {
    return null;
  }

  verifyRequestSignature() {
    return false;
  }
}

class RealSlackService implements SlackService {
  private readonly botClient = new WebClient(env.slackBotToken);
  private readonly adminClient = new WebClient(env.slackAdminUserToken);

  async inviteCandidate(input: { email: string; channelIds?: string[] }) {
    const channelIds = input.channelIds?.length
      ? input.channelIds
      : env.slackDefaultChannelIds;

    if (!env.slackTeamId) {
      throw new Error("SLACK_TEAM_ID is required for real Slack invite mode.");
    }

    if (channelIds.length === 0) {
      throw new Error("At least one Slack channel is required for real invite mode.");
    }

    try {
      const response = await this.adminClient.apiCall("admin.users.invite", {
        team_id: env.slackTeamId,
        email: input.email,
        channel_ids: channelIds.join(","),
      });

      return {
        externalId:
          (response as { invite_id?: string }).invite_id ?? input.email,
      };
    } catch (error) {
      const errorCode = readSlackErrorCode(error);

      if (
        errorCode === "already_in_team" ||
        errorCode === "already_in_team_invited_user"
      ) {
        return {
          externalId: input.email,
        };
      }

      throw error;
    }
  }

  async sendDirectMessage(input: { slackUserId: string; text: string }) {
    const conversation = await this.botClient.conversations.open({
      users: input.slackUserId,
    });

    if (!conversation.channel?.id) {
      throw new Error("Unable to open a Slack DM channel.");
    }

    await this.botClient.chat.postMessage({
      channel: conversation.channel.id,
      text: input.text,
    });
  }

  async notifyHr(input: { text: string }) {
    if (!env.slackHrChannelId) {
      return;
    }

    await this.botClient.chat.postMessage({
      channel: env.slackHrChannelId,
      text: input.text,
    });
  }

  async getUserEmail(slackUserId: string) {
    const response = await this.botClient.users.info({
      user: slackUserId,
    });

    return response.user?.profile?.email ?? null;
  }

  verifyRequestSignature(input: {
    rawBody: string;
    timestamp: string;
    signature: string;
  }) {
    if (!input.signature || !input.timestamp || !isFreshSlackTimestamp(input.timestamp)) {
      return false;
    }

    const basestring = `v0:${input.timestamp}:${input.rawBody}`;
    const digest = `v0=${createHmac("sha256", env.slackSigningSecret)
      .update(basestring)
      .digest("hex")}`;

    return safelyCompareSlackSignatures(digest, input.signature);
  }
}

export function getSlackService(): SlackService {
  if (
    process.env.NODE_ENV === "test" ||
    !env.slackBotToken ||
    !env.slackAdminUserToken ||
    !env.slackSigningSecret
  ) {
    return new LocalSlackService();
  }

  return new RealSlackService();
}
