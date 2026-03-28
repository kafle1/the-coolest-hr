// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  submitApplicationMock,
  runApplicationAutomationMock,
  checkRateLimitMock,
  getClientIpMock,
  afterMock,
} = vi.hoisted(() => ({
  submitApplicationMock: vi.fn(),
  runApplicationAutomationMock: vi.fn(),
  checkRateLimitMock: vi.fn(),
  getClientIpMock: vi.fn(),
  afterMock: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();

  return {
    ...actual,
    after: afterMock,
  };
});

vi.mock("@/lib/applications/service", () => ({
  submitApplication: submitApplicationMock,
  runApplicationAutomation: runApplicationAutomationMock,
}));

vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
  getClientIp: getClientIpMock,
}));

describe("POST /api/applications", () => {
  let scheduledAutomationTask: (() => Promise<void>) | null = null;

  beforeEach(() => {
    checkRateLimitMock.mockReturnValue({ success: true });
    getClientIpMock.mockReturnValue("127.0.0.1");
    submitApplicationMock.mockResolvedValue({
      applicationId: "application-123",
      confirmationEmailError: null,
    });
    runApplicationAutomationMock.mockResolvedValue(null);
    afterMock.mockImplementation((callback: () => Promise<void>) => {
      scheduledAutomationTask = callback;
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
    scheduledAutomationTask = null;
  });

  it("schedules automation after responding", async () => {
    const { POST } = await import("@/app/api/applications/route");
    const formData = new FormData();

    formData.set("fullName", "Candidate Example");

    const response = await POST(
      new Request("http://localhost/api/applications", {
        method: "POST",
        body: formData,
      }),
    );
    const payload = (await response.json()) as {
      ok: boolean;
      applicationId: string;
      message: string;
    };

    expect(runApplicationAutomationMock).not.toHaveBeenCalled();
    expect(afterMock).toHaveBeenCalledOnce();
    expect(typeof scheduledAutomationTask).toBe("function");
    expect(payload).toEqual({
      ok: true,
      applicationId: "application-123",
      message: "Application submitted successfully. We will update you by email.",
    });

    await scheduledAutomationTask?.();

    expect(runApplicationAutomationMock).toHaveBeenCalledWith("application-123");
  });

  it("returns a warning when the confirmation email could not be delivered", async () => {
    submitApplicationMock.mockResolvedValue({
      applicationId: "application-123",
      confirmationEmailError: "Resend is still in testing mode.",
    });

    const { POST } = await import("@/app/api/applications/route");
    const response = await POST(
      new Request("http://localhost/api/applications", {
        method: "POST",
        body: new FormData(),
      }),
    );
    const payload = (await response.json()) as {
      ok: boolean;
      applicationId: string;
      message: string;
      warning?: string;
    };

    expect(payload.warning).toBe("Resend is still in testing mode.");
    expect(payload.message).toBe(
      "Application submitted, but the confirmation email could not be delivered.",
    );
  });
});
