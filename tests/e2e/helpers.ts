import { expect, type Page } from "@playwright/test";

export async function unlockDashboard(page: Page, accessKey = "playwright-e2e-key") {
  await page.goto("/");
  await expect(page.getByText("Unlock the single-user control plane.")).toBeVisible();
  await page.getByLabel("Access key").fill(accessKey);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("Policy-aware orchestration with a reproducible spec document.")).toBeVisible();
}
