import { describe, expect, it } from "vitest";

import { applicationSubmissionSchema } from "@/lib/applications/service";

describe("applicationSubmissionSchema", () => {
  it("normalizes an empty portfolio URL to undefined", () => {
    const parsed = applicationSubmissionSchema.parse({
      fullName: "Niraj Kafle",
      email: "niraj@example.com",
      linkedinUrl: "https://linkedin.com/in/niraj",
      portfolioUrl: "",
      roleId: "role_123",
    });

    expect(parsed.portfolioUrl).toBeUndefined();
  });

  it("normalizes email addresses to lowercase", () => {
    const parsed = applicationSubmissionSchema.parse({
      fullName: "Niraj Kafle",
      email: "NIRAJ@EXAMPLE.COM",
      linkedinUrl: "https://linkedin.com/in/niraj",
      portfolioUrl: "",
      roleId: "role_123",
    });

    expect(parsed.email).toBe("niraj@example.com");
  });

  it("rejects malformed email addresses", () => {
    expect(() =>
      applicationSubmissionSchema.parse({
        fullName: "Niraj Kafle",
        email: "niraj",
        linkedinUrl: "https://linkedin.com/in/niraj",
        portfolioUrl: "",
        roleId: "role_123",
      }),
    ).toThrow();
  });
});
