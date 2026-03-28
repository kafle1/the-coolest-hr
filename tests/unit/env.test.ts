import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("env Google service account loading", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("loads Google service account credentials from GOOGLE_APPLICATION_CREDENTIALS", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "niural-env-"));
    const credentialFile = join(tempDir, "service-account.json");
    const privateKey = "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----\n";

    writeFileSync(
      credentialFile,
      JSON.stringify({
        type: "service_account",
        client_email: "calendar-bot@example.com",
        private_key: privateKey,
      }),
    );

    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialFile;

    try {
      const { env } = await import("@/lib/utils/env");

      expect(env.googleServiceAccountEmail).toBe("calendar-bot@example.com");
      expect(env.googleServiceAccountPrivateKey).toBe(privateKey);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("prefers explicit env variables over the credential file", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "niural-env-"));
    const credentialFile = join(tempDir, "service-account.json");

    writeFileSync(
      credentialFile,
      JSON.stringify({
        type: "service_account",
        client_email: "calendar-bot@example.com",
        private_key: "-----BEGIN PRIVATE KEY-----\nfrom-file\n-----END PRIVATE KEY-----\n",
      }),
    );

    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialFile;
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "override@example.com";
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY =
      "-----BEGIN PRIVATE KEY-----\\nfrom-env\\n-----END PRIVATE KEY-----\\n";

    try {
      const { env } = await import("@/lib/utils/env");

      expect(env.googleServiceAccountEmail).toBe("override@example.com");
      expect(env.googleServiceAccountPrivateKey).toBe(
        "-----BEGIN PRIVATE KEY-----\nfrom-env\n-----END PRIVATE KEY-----\n",
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});