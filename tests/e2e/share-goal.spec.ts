import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { openRequestComposer, unlockDashboard } from "./helpers";

function createSignedShareToken(goalId: string, expiresAt: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      goalId,
      exp: Date.parse(expiresAt),
      v: 1
    }),
    "utf8"
  ).toString("base64url");
  const signature = createHmac("sha256", "playwright-e2e-key:agentic-share-v1").update(payload).digest("base64url");

  return `${payload}.${signature}`;
}

async function sumVisibleViewedCounts(page: Page): Promise<number> {
  const metrics = await page.locator(".request-card .share-metric").allTextContents();

  return metrics.reduce((total, metric) => {
    const match = metric.match(/·\s+(\d+)\s+viewed$/u);

    return total + (match ? Number.parseInt(match[1], 10) : 0);
  }, 0);
}

test("creates a public goal share link and opens the shared page", async ({ page }) => {
  await unlockDashboard(page);

  const { requestCard, requestInput, submitButton } = await openRequestComposer(page);
  await requestInput.fill(
    "Triage my inbox and prepare replies for important clients."
  );
  await expect(submitButton).toBeEnabled({ timeout: 15_000 });
  await submitButton.click();
  await expect(requestCard.locator(".status-chip.success").getByText("Created a new goal bundle.")).toBeVisible({
    timeout: 15_000
  });

  const createdGoal = page
    .locator(".request-card .list-item")
    .filter({
      hasText: "Inbox triage and follow-up prep"
    })
    .first();

  await expect(createdGoal).toBeVisible();
  await createdGoal.getByRole("button", { name: "Copy share link" }).click();

  await expect(
    page.locator(".share-status-row .status-chip").filter({
      hasText: /(Copied|Created) a public share link for "Inbox triage and follow-up prep"\./
    })
  ).toBeVisible();
  await page.getByRole("link", { name: "Open public share page" }).click();

  await expect(page.getByText("Shared from Agentic")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inbox triage and follow-up prep" })).toBeVisible();
  await expect(page.getByText("Read-only shared goal")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Artifacts" })).toBeVisible();
});

test("keeps the share flow successful when clipboard access is blocked", async ({ page }) => {
  await unlockDashboard(page);

  const { requestCard, requestInput, submitButton } = await openRequestComposer(page);
  await requestInput.fill(
    "Triage my inbox and prepare replies for important clients."
  );
  await expect(submitButton).toBeEnabled({ timeout: 15_000 });
  await submitButton.click();
  await expect(requestCard.locator(".status-chip.success").getByText("Created a new goal bundle.")).toBeVisible({
    timeout: 15_000
  });
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Write permission denied.");
        }
      }
    });
  });

  const createdGoal = page
    .locator(".request-card .list-item")
    .filter({
      hasText: "Inbox triage and follow-up prep"
    })
    .first();

  await createdGoal.getByRole("button", { name: "Copy share link" }).click();

  await expect(
    page.locator(".share-status-row .status-chip").filter({
      hasText: 'Created a public share link for "Inbox triage and follow-up prep".'
    })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Open public share page" })).toBeVisible();
});

test("renders a valid public share page in a fresh unauthenticated context and does not double-count an immediate refresh", async ({
  browser,
  page
}) => {
  await unlockDashboard(page);

  const { requestCard, requestInput, submitButton } = await openRequestComposer(page);
  await requestInput.fill(
    "Triage my inbox and prepare replies for important clients."
  );
  await expect(submitButton).toBeEnabled({ timeout: 15_000 });
  await submitButton.click();
  await expect(requestCard.locator(".status-chip.success").getByText("Created a new goal bundle.")).toBeVisible({
    timeout: 15_000
  });

  const createdGoal = page
    .locator(".request-card .list-item")
    .filter({
      hasText: "Inbox triage and follow-up prep"
    })
    .first();

  await createdGoal.getByRole("button", { name: "Copy share link" }).click();

  const shareLink = page.getByRole("link", { name: "Open public share page" });
  const shareUrl = await shareLink.getAttribute("href");

  expect(shareUrl).toBeTruthy();

  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  const viewedCountBeforePublicView = await sumVisibleViewedCounts(page);
  const viewTracked = publicPage.waitForResponse(
    (response) => response.url().includes("/api/share/view") && response.status() === 202
  );

  await publicPage.goto(shareUrl!);
  await viewTracked;
  await expect(publicPage.getByText("Shared from Agentic")).toBeVisible();
  await expect(publicPage.getByRole("heading", { name: "Inbox triage and follow-up prep" })).toBeVisible();
  await expect(publicPage.getByText("Read-only shared goal")).toBeVisible();

  const publicHtml = await publicPage.content();
  expect(publicHtml).not.toContain("Approvals inbox");
  expect(publicHtml).not.toContain("Integration controls");
  expect(publicHtml).not.toContain("Recent activity");

  await publicPage.reload();
  await publicContext.close();
  await expect
    .poll(
      async () => {
        await page.reload();
        return sumVisibleViewedCounts(page);
      },
      { timeout: 15_000 }
    )
    .toBe(viewedCountBeforePublicView + 1);
});

test("shows the invalid-share page for tampered or missing shared goals", async ({ page }) => {
  const tamperedToken = "invalid-token";
  const missingGoalToken = createSignedShareToken("goal-does-not-exist", "2026-04-09T00:00:00.000Z");

  await page.goto(`/share/${tamperedToken}`);
  await expect(page.getByRole("heading", { name: "That share link is invalid or expired." })).toBeVisible();
  await expect(page.getByText("Share unavailable")).toBeVisible();

  await page.goto(`/share/${encodeURIComponent(missingGoalToken)}`);
  await expect(page.getByRole("heading", { name: "That share link is invalid or expired." })).toBeVisible();
  await expect(page.getByText("Share unavailable")).toBeVisible();
});
