// @vitest-environment node

import { ApplicationStatus, RoleStatus } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { listAdminApplications } from "@/lib/applications/service";
import { prisma } from "@/lib/prisma/client";
import { disconnectDatabase, resetDatabase } from "@/tests/helpers/db";

describe("listAdminApplications", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it("filters applications by roleId", async () => {
    const [roleOne, roleTwo] = await Promise.all([
      prisma.role.create({
        data: {
          slug: "admin-filter-role-one",
          title: "AI Product Operator",
          team: "Product",
          location: "Nepal",
          remoteStatus: "Remote",
          experienceLevel: "Senior",
          summary: "Role one",
          responsibilities: ["Ship tools"],
          requirements: ["Write code"],
          status: RoleStatus.OPEN,
        },
      }),
      prisma.role.create({
        data: {
          slug: "admin-filter-role-two",
          title: "AI Operations Analyst",
          team: "Operations",
          location: "Remote",
          remoteStatus: "Remote",
          experienceLevel: "Senior",
          summary: "Role two",
          responsibilities: ["Improve workflows"],
          requirements: ["Write docs"],
          status: RoleStatus.OPEN,
        },
      }),
    ]);

    await Promise.all([
      prisma.application.create({
        data: {
          fullName: "Role One Candidate",
          email: "role-one@example.com",
          linkedinUrl: "https://linkedin.com/in/role-one",
          status: ApplicationStatus.APPLIED,
          roleId: roleOne.id,
        },
      }),
      prisma.application.create({
        data: {
          fullName: "Role Two Candidate",
          email: "role-two@example.com",
          linkedinUrl: "https://linkedin.com/in/role-two",
          status: ApplicationStatus.APPLIED,
          roleId: roleTwo.id,
        },
      }),
    ]);

    const filtered = await listAdminApplications({ roleId: roleOne.id });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.roleId).toBe(roleOne.id);
    expect(filtered[0]?.fullName).toBe("Role One Candidate");
  });
});
