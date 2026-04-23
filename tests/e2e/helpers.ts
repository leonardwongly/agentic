import { expect, type Locator, type Page } from "@playwright/test";

export const REQUEST_PLACEHOLDER =
  "Example: Clear today’s approvals, surface blocked commitments, and draft replies for anything urgent.";
export const E2E_UI_TIMEOUT_MS = process.env.CI ? 15_000 : 5_000;

export async function unlockDashboard(page: Page, accessKey = "playwright-e2e-key") {
  await page.goto("/");
  await expect(page.getByText("Unlock the single-user control plane.")).toBeVisible({
    timeout: E2E_UI_TIMEOUT_MS
  });
  await page.getByLabel("Access key").fill(accessKey);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("button", { name: "Request work" })).toBeVisible({
    timeout: E2E_UI_TIMEOUT_MS
  });
  await expect(page.getByRole("heading", { name: "Run commitments, approvals, and automations from one governed loop." })).toBeVisible({
    timeout: E2E_UI_TIMEOUT_MS
  });
}

export async function openRequestComposer(page: Page) {
  await page.getByRole("button", { name: "Request work" }).click();
  const requestCard = page.locator(".request-card");
  const requestInput = requestCard.getByPlaceholder(REQUEST_PLACEHOLDER);

  await expect(requestCard).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
  await expect(requestInput).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  return { requestCard, requestInput };
}

export async function submitRequest(requestCard: Locator, requestInput: Locator, request: string) {
  await requestInput.fill(request);
  await expect(requestInput).toHaveValue(request, { timeout: E2E_UI_TIMEOUT_MS });

  const submitButton = requestCard.locator(".hero-button-row").getByRole("button", {
    name: "Submit request"
  });

  // Hosted CI runners can take longer to propagate the composer state after
  // input events, leaving the submit button temporarily disabled.
  await expect(submitButton).toBeEnabled({ timeout: E2E_UI_TIMEOUT_MS });
  await submitButton.click();
  await expect(submitButton).toBeDisabled({ timeout: E2E_UI_TIMEOUT_MS });
  await expect(requestInput).toHaveValue("", { timeout: E2E_UI_TIMEOUT_MS });
  await expect(requestCard.locator(".status-chip.success").getByText("Created a new goal bundle.")).toBeVisible({
    timeout: E2E_UI_TIMEOUT_MS
  });
}

export async function expectShareLinkReady(page: Page, goalTitle: string) {
  const escapedGoalTitle = goalTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  await expect(
    page.locator(".share-status-row .status-chip").filter({
      hasText: new RegExp(`(Copied|Created) a public share link for "${escapedGoalTitle}"\\.`, "u")
    })
  ).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
}

export async function showAdvancedOperations(page: Page) {
  const showButton = page.getByRole("button", { name: "Show advanced operations" });

  if (await showButton.isVisible()) {
    await showButton.click();
  }

  await expect(page.getByRole("heading", { name: "Local notes" })).toBeVisible({
    timeout: E2E_UI_TIMEOUT_MS
  });
}
