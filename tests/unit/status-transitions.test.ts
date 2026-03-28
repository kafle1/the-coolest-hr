import { ApplicationStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  canTransitionStatus,
  listManualOverrideTargets,
} from "@/lib/status/transitions";

describe("canTransitionStatus", () => {
  it("allows manual rescue from rejected to shortlisted", () => {
    expect(
      canTransitionStatus(ApplicationStatus.REJECTED, ApplicationStatus.SHORTLISTED),
    ).toBe(true);
  });

  it("blocks skipping the workflow into onboarding", () => {
    expect(
      canTransitionStatus(ApplicationStatus.APPLIED, ApplicationStatus.ONBOARDED),
    ).toBe(false);
  });

  it("only exposes valid manual override targets for the current status", () => {
    expect(listManualOverrideTargets(ApplicationStatus.SCREENED)).toEqual([
      ApplicationStatus.SHORTLISTED,
      ApplicationStatus.REJECTED,
    ]);
    expect(listManualOverrideTargets(ApplicationStatus.SLACK_INVITED)).toEqual([]);
  });
});
