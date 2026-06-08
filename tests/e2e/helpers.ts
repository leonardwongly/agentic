import { expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

export const REQUEST_PLACEHOLDER =
  "Example: Clear today’s approvals, surface blocked commitments, and draft replies for anything urgent.";
export const E2E_UI_TIMEOUT_MS = process.env.CI ? 45_000 : 5_000;

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

export async function enablePublicSharingForE2E(page: Page) {
  const current = await page.request.get("/api/governance");
  expect(current.status()).toBe(200);
  const currentETag = current.headers().etag;
  expect(currentETag).toBeTruthy();

  const response = await page.request.post("/api/governance", {
    headers: {
      "if-match": currentETag!
    },
    data: {
      publicSharingEnabled: true
    }
  });

  expect(response.status()).toBe(200);
}

export async function openRequestComposer(page: Page) {
  await page.getByRole("button", { name: "Request work" }).click();
  const requestCard = page.locator("#section-goals.request-card");
  const requestInput = requestCard.getByPlaceholder(REQUEST_PLACEHOLDER);

  await expect(requestCard).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
  await expect(requestInput).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  return { requestCard, requestInput };
}

export async function submitRequest(requestCard: Locator, requestInput: Locator, request: string) {
  const page = requestCard.page();
  const submitButton = requestCard.locator(".hero-button-row").getByRole("button", {
    name: "Submit request"
  });

  // Submitting can race with the dashboard's periodic refresh re-rendering the
  // composer, which occasionally swallows the first click before it fires the
  // request (a flaky timeout waiting for the success chip, esp. on mobile). Tie
  // the click to the POST /api/goals response and retry once if it does not fire.
  let submitted = false;
  for (let attempt = 0; attempt < 2 && !submitted; attempt += 1) {
    await requestInput.fill(request);
    await expect(requestInput).toHaveValue(request, { timeout: E2E_UI_TIMEOUT_MS });
    await requestInput.press("Tab");

    // Hosted CI runners can take longer to propagate the composer state after
    // input events and initial dashboard refreshes, leaving the submit button
    // temporarily disabled even after the textarea reflects the new request.
    await expect(submitButton).toBeEnabled({ timeout: E2E_UI_TIMEOUT_MS });

    try {
      await Promise.all([
        page.waitForResponse(
          (response) => response.url().includes("/api/goals") && response.request().method() === "POST",
          { timeout: 20_000 }
        ),
        submitButton.click()
      ]);
      submitted = true;
    } catch {
      if (attempt === 1) {
        throw new Error("Goal submission did not fire a POST /api/goals request after retrying.");
      }
    }
  }

  await expect(requestCard.locator(".status-chip.success").getByText("Created a new goal bundle.")).toBeVisible({
    timeout: E2E_UI_TIMEOUT_MS * 3
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

export async function createPublicShareBrowserContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: undefined
    });
  });

  return context;
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
