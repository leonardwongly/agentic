import { expect, test } from "@playwright/test";
import { unlockDashboard } from "./helpers";

test("serves baseline security headers on the dashboard shell", async ({ page }) => {
  const response = await page.goto("/");

  expect(response).not.toBeNull();
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  expect(response?.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(response?.headers()["permissions-policy"]).toContain("camera=()");
});

test("serves a nonce-backed content security policy on HTML pages", async ({ page }) => {
  const response = await page.request.get("/");
  const html = await response.text();
  const csp = response.headers()["content-security-policy"];

  expect(csp).toBeTruthy();
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self' 'nonce-");
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).toContain("style-src 'self' 'nonce-");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("'unsafe-inline'");
  expect(csp).not.toContain("'unsafe-eval'");
  expect(html).toMatch(/<script[^>]+nonce="[^"]+"/u);
});

test("keeps the authenticated dashboard non-cacheable and applies security headers to public share pages", async ({ browser, page }) => {
  await unlockDashboard(page);

  const dashboardResponse = await page.goto("/");

  expect(dashboardResponse).not.toBeNull();
  expect(dashboardResponse?.headers()["cache-control"]).toContain("no-store");

  await page.getByPlaceholder("Example: Triage my inbox and draft replies for anything urgent.").fill(
    "Triage my inbox and prepare replies for important clients."
  );
  await page.getByRole("button", { name: "Create goal" }).click();

  const createdGoal = page
    .locator(".request-card .list-item")
    .filter({
      hasText: "Inbox triage and follow-up prep"
    })
    .first();

  await createdGoal.getByRole("button", { name: "Copy share link" }).click();

  const shareUrl = await page.getByRole("link", { name: "Open public share page" }).getAttribute("href");

  expect(shareUrl).toBeTruthy();

  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  const publicResponse = await publicPage.goto(shareUrl!);

  expect(publicResponse).not.toBeNull();
  expect(publicResponse?.headers()["x-content-type-options"]).toBe("nosniff");
  expect(publicResponse?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(publicResponse?.headers()["x-frame-options"]).toBe("DENY");
  expect(publicResponse?.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(publicResponse?.headers()["content-security-policy"]).toContain("script-src 'self' 'nonce-");

  await publicContext.close();
});
