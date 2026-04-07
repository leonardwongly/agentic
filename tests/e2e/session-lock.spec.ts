import { expect, test } from "@playwright/test";
import { unlockDashboard } from "./helpers";

test("locks the session and denies protected API access", async ({ page }) => {
  await unlockDashboard(page);

  const authenticatedAccess = await page.evaluate(async () => {
    const response = await fetch("/api/integrations/local-notes");
    return {
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      body: (await response.json()) as { notes?: unknown[]; error?: string }
    };
  });

  expect(authenticatedAccess.status).toBe(200);
  expect(authenticatedAccess.cacheControl).toContain("no-store");
  expect(Array.isArray(authenticatedAccess.body.notes)).toBe(true);

  await page.getByRole("button", { name: "Lock session" }).click();
  await expect(page.getByText("Unlock the single-user control plane.")).toBeVisible();

  const lockedAccess = await page.evaluate(async () => {
    const response = await fetch("/api/integrations/local-notes");
    return {
      status: response.status,
      body: (await response.json()) as { error?: string }
    };
  });

  expect(lockedAccess.status).toBe(401);
  expect(lockedAccess.body.error).toContain("session");
});
