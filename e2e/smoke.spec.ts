import { expect, test } from "@playwright/test";

test("core pages and APIs are reachable end-to-end", async ({ page, request }) => {
  const applyPage = await request.get("/apply");
  expect(applyPage.ok()).toBeTruthy();
  await expect(await applyPage.text()).toContain("Submit your details");

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByRole("heading", { name: "Admin Login" })).toBeVisible();

  const homePage = await request.get("/");
  expect(homePage.ok()).toBeTruthy();
  const homeMarkup = await homePage.text();
  await expect(homeMarkup).toContain("Join a team building ambitious products with care");
  await expect(homeMarkup).not.toContain("Admin Dashboard");
});
