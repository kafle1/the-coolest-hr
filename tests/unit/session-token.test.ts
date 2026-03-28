import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("session token", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      ADMIN_EMAIL: "admin@niural.com",
      ADMIN_PASSWORD: "dummy-admin-pwd",
      SESSION_SIGNING_SECRET: "session-signing-secret",
      NODE_ENV: "test",
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("creates verifiable session tokens", async () => {
    const { createSessionToken, verifySessionToken } = await import("@/lib/auth/session-token");

    const token = await createSessionToken("admin@niural.com");

    await expect(verifySessionToken(token)).resolves.toBe("admin@niural.com");
  });

  it("rejects tampered session tokens", async () => {
    const { createSessionToken, verifySessionToken } = await import("@/lib/auth/session-token");

    const token = await createSessionToken("admin@niural.com");
    const [payload, signature] = token.split(".");

    await expect(verifySessionToken(`${payload}.tampered${signature}`)).resolves.toBeNull();
  });

  it("requires an explicit session secret in production", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
    };
    delete process.env.SESSION_SIGNING_SECRET;

    const { createSessionToken } = await import("@/lib/auth/session-token");

    await expect(createSessionToken("admin@niural.com")).rejects.toThrow(
      "SESSION_SIGNING_SECRET is required in production.",
    );
  });
});