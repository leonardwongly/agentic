import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  enablePublicSharingForE2E,
  expectShareLinkReady,
  openRequestComposer,
  submitRequest,
  unlockDashboard
} from "./helpers";

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

function isPublicShareViewRequest(url: string, method: string): boolean {
  return method === "POST" && url.includes("/api/share/view");
}

test("creates a public goal share link and opens the shared page", async ({ page }) => {
  await unlockDashboard(page);
  await enablePublicSharingForE2E(page);

  const { requestCard, requestInput } = await openRequestComposer(page);
  await submitRequest(
    requestCard,
    requestInput,
    "Triage my inbox and prepare replies for important clients."
  );

  const createdGoal = page
    .locator(".request-card .list-item")
    .filter({
      hasText: "Inbox triage and follow-up prep"
    })
    .first();
  const copyShareLinkButton = createdGoal.getByRole("button", { name: "Copy share link" });

  await expect(createdGoal).toBeVisible();
  await expect(copyShareLinkButton).toBeEnabled();
  await copyShareLinkButton.click();
  await expectShareLinkReady(page, "Inbox triage and follow-up prep");
  await page.getByRole("link", { name: "Open public share page" }).click();

  await expect(page.getByText("Shared from Agentic")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inbox triage and follow-up prep" })).toBeVisible();
  await expect(page.getByText("Read-only shared goal")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Artifacts" })).toBeVisible();
});

test("keeps the share flow successful when clipboard access is blocked", async ({ page }) => {
  await unlockDashboard(page);
  await enablePublicSharingForE2E(page);

  const { requestCard, requestInput } = await openRequestComposer(page);
  await submitRequest(
    requestCard,
    requestInput,
    "Triage my inbox and prepare replies for important clients."
  );
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
  const copyShareLinkButton = createdGoal.getByRole("button", { name: "Copy share link" });

  await expect(createdGoal).toBeVisible();
  await expect(copyShareLinkButton).toBeEnabled();
  await copyShareLinkButton.click();
  await expectShareLinkReady(page, "Inbox triage and follow-up prep");
  await expect(page.getByRole("link", { name: "Open public share page" })).toBeVisible();
});

test("renders a valid public share page in a fresh unauthenticated context and does not double-count an immediate refresh", async ({
  browser,
  page
}) => {
  await unlockDashboard(page);
  await enablePublicSharingForE2E(page);

  const { requestCard, requestInput } = await openRequestComposer(page);
  await submitRequest(
    requestCard,
    requestInput,
    "Triage my inbox and prepare replies for important clients."
  );

  const createdGoal = page
    .locator(".request-card .list-item")
    .filter({
      hasText: "Inbox triage and follow-up prep"
    })
    .first();
  const copyShareLinkButton = createdGoal.getByRole("button", { name: "Copy share link" });

  await expect(createdGoal).toBeVisible();
  await expect(copyShareLinkButton).toBeEnabled();
  await copyShareLinkButton.click();

  const shareLink = page.getByRole("link", { name: "Open public share page" });
  const shareUrl = await shareLink.getAttribute("href");

  expect(shareUrl).toBeTruthy();

  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  const viewedCountBeforePublicView = await sumVisibleViewedCounts(page);
  const firstViewTracked = publicPage.waitForResponse((response) =>
    isPublicShareViewRequest(response.url(), response.request().method())
  );

  await publicPage.goto(shareUrl!);
  await expect(publicPage.getByText("Shared from Agentic")).toBeVisible();
  await expect(publicPage.getByRole("heading", { name: "Inbox triage and follow-up prep" })).toBeVisible();
  await expect(publicPage.getByText("Read-only shared goal")).toBeVisible();
  expect((await firstViewTracked).status()).toBe(202);

  const publicHtml = await publicPage.content();
  expect(publicHtml).not.toContain("Approvals inbox");
  expect(publicHtml).not.toContain("Integration controls");
  expect(publicHtml).not.toContain("Recent activity");

  const refreshTracked = publicPage.waitForResponse((response) =>
    isPublicShareViewRequest(response.url(), response.request().method())
  );
  await publicPage.reload();
  expect((await refreshTracked).status()).toBe(202);
  await publicContext.close();

  await expect
    .poll(
      async () => {
        await page.reload();
        return sumVisibleViewedCounts(page);
      },
      { timeout: 10_000 }
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
