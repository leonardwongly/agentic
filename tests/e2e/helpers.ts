import { expect, type Page } from "@playwright/test";

export const REQUEST_PLACEHOLDER =
  "Example: Clear today’s approvals, surface blocked commitments, and draft replies for anything urgent.";

export async function unlockDashboard(page: Page, accessKey = "playwright-e2e-key") {
  await page.goto("/");
  await expect(page.getByText("Unlock the single-user control plane.")).toBeVisible();
  await page.getByLabel("Access key").fill(accessKey);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("button", { name: "Request work" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Run commitments, approvals, and automations from one governed loop." })).toBeVisible();
}

export async function openRequestComposer(page: Page) {
  await page.getByRole("button", { name: "Request work" }).click();
  const requestCard = page.locator(".request-card");
  const requestInput = requestCard.getByPlaceholder(REQUEST_PLACEHOLDER);

  await expect(requestCard).toBeVisible();
  await expect(requestInput).toBeVisible();

  return { requestCard, requestInput };
}

export async function showAdvancedOperations(page: Page) {
  const showButton = page.getByRole("button", { name: "Show advanced operations" });

  if (await showButton.isVisible()) {
    await showButton.click();
  }

  await expect(page.getByRole("heading", { name: "Local notes" })).toBeVisible();
}
