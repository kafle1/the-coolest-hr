// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  submitApplicationMock,
  runApplicationAutomationMock,
  checkRateLimitMock,
  getClientIpMock,
} = vi.hoisted(() => ({
  submitApplicationMock: vi.fn(),
  runApplicationAutomationMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  getClientIpMock: vi.fn(),
}));

vi.mock("@/lib/applications/service", () => ({
  submitApplication: submitApplicationMock,
  runApplicationAutomation: runApplicationAutomationMock,
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
  getClientIp: getClientIpMock,
}));

import { POST } from "@/app/api/applications/route";

function buildRequest() {
  const formData = new FormData();

  formData.set("fullName", "Route Candidate");
  formData.set("email", "route@example.com");
  formData.set("linkedinUrl", "https://linkedin.com/in/route");
  formData.set("roleId", "role-123");
  formData.set(
    "resume",
    new File(["resume"], "resume.pdf", {
      type: "application/pdf",
    }),
  );

  return new Request("http://localhost/api/applications", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/applications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientIpMock.mockReturnValue("127.0.0.1");
    checkRateLimitMock.mockReturnValue({ success: true });
    submitApplicationMock.mockResolvedValue("application-123");
    runApplicationAutomationMock.mockResolvedValue({
      applicationId: "application-123",
      score: 88,
      shortlisted: true,
      summary: "Strong match.",
    });
  });

  it("returns after storing the application while automation continues in the background", async () => {
    let releaseAutomation: (() => void) | undefined;

    runApplicationAutomationMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseAutomation = resolve;
        }),
    );

    const response = await Promise.race([
      POST(buildRequest()),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("POST did not return before automation finished."));
        }, 100);
      }),
    ]);
    const payload = (await response.json()) as {
      ok: boolean;
      applicationId: string;
      message: string;
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      applicationId: "application-123",
      message: "Application received. We will email you as your application moves forward.",
    });
    expect(submitApplicationMock).toHaveBeenCalledOnce();
    expect(runApplicationAutomationMock).toHaveBeenCalledWith("application-123");
    expect(submitApplicationMock.mock.invocationCallOrder[0]).toBeLessThan(
      runApplicationAutomationMock.mock.invocationCallOrder[0],
    );

    releaseAutomation?.();
  });
});
