import { expect, test, type Page } from "@playwright/test";
import {
  E2E_UI_TIMEOUT_MS,
  openRequestComposer,
  showAdvancedOperations,
  submitRequest,
  unlockDashboard
} from "./helpers";

// Adversarial "confused / hostile user" sweep. Every assertion encodes INTENDED
// behavior for degenerate inputs and is grounded in apps/web component source
// (never contradicted by the existing passing specs). Kept sequential-safe:
// playwright.config.ts runs workers:1, fullyParallel:false.
test.setTimeout(process.env.CI ? 120_000 : 60_000);

const NOTE_TITLE_PLACEHOLDER = "Example: Travel packing list";
const NOTE_BODY_PLACEHOLDER = "Write a note that should be searchable through the notes adapter.";
const EDITOR_TITLE_PLACEHOLDER = "Open a note to edit its title";
const EDITOR_BODY_PLACEHOLDER = "Open a note to edit its body.";

// Mirrors the local (non-exported) helper in dashboard-cockpit specs so hostile
// long / bidi text can be checked for real layout breakage.
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth
  }));

  expect(overflow.html).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
}

function submitButtonOf(page: Page) {
  // dashboard-goals-card.tsx: <button className="primary-button">"Submit request"</button>
  // inside <div className="hero-button-row">, disabled={isPending}.
  return page.locator(".request-card .hero-button-row").getByRole("button", { name: "Submit request" });
}

test("empty request shows an inline, actionable error instead of a silent no-op", async ({ page }) => {
  // dashboard.tsx createGoal(): empty request -> setSubmitState({ kind: "error",
  // message: "Enter a request before submitting." }); dashboard-goals-card.tsx renders
  // it as <p className={`status-chip ${submitState.kind}`}> inside the request card.
  await unlockDashboard(page);

  const { requestCard } = await openRequestComposer(page);
  const submitButton = submitButtonOf(page);

  await expect(submitButton).toBeEnabled({ timeout: E2E_UI_TIMEOUT_MS });
  await submitButton.click();

  await expect(requestCard.locator(".status-chip.error")).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
  await expect(requestCard.getByText("Enter a request before submitting.")).toBeVisible({
    timeout: E2E_UI_TIMEOUT_MS
  });
  // It is a validation message, not a crash/disable: the composer stays usable.
  await expect(submitButton).toBeEnabled();
});

test("empty note form is rejected inline without creating a note", async ({ page }) => {
  // dashboard.tsx createLocalNote(): missing title OR content ->
  // setSubmitState({ kind: "error", message: "A local note needs both a title and content." }).
  await unlockDashboard(page);
  await showAdvancedOperations(page);

  await page.getByPlaceholder(NOTE_TITLE_PLACEHOLDER).fill("Only a title, no body");
  await page.getByRole("button", { name: "Create local note" }).click();

  await expect(page.getByText("A local note needs both a title and content.")).toBeVisible({
    timeout: E2E_UI_TIMEOUT_MS
  });
  await expect(page.getByText("Created a new local note.")).toHaveCount(0);
});

test("rapid double-submit is guarded: in-flight button disables and only one goal job posts", async ({ page }) => {
  // submitGoalRequest() sets isPending(true) and awaits the polled job AFTER the POST
  // response resolves, so "Submit request" stays disabled for the whole flight
  // (dashboard-goals-card.tsx disabled={isPending}) -> a second click cannot fire a
  // second POST /api/goals.
  await unlockDashboard(page);

  const goalPosts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/goals")) {
      goalPosts.push(request.url());
    }
  });

  const { requestCard, requestInput } = await openRequestComposer(page);
  const submitButton = submitButtonOf(page);
  await requestInput.fill("Triage my inbox and prepare replies for important clients.");
  await requestInput.press("Tab");
  await expect(submitButton).toBeEnabled({ timeout: E2E_UI_TIMEOUT_MS });

  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/api/goals") && response.request().method() === "POST",
      { timeout: 20_000 }
    ),
    submitButton.click()
  ]);

  // Visible double-submit protection while the job is still being polled.
  await expect(submitButton).toBeDisabled({ timeout: E2E_UI_TIMEOUT_MS });
  // Hostile immediate second attempt: should be swallowed by the disabled control.
  await submitButton.click({ timeout: 800, noWaitAfter: true }).catch(() => {});

  await expect(requestCard.locator(".status-chip.success").getByText("Created a new goal bundle.")).toBeVisible({
    timeout: E2E_UI_TIMEOUT_MS * 3
  });
  expect(goalPosts.length).toBe(1);
  await expect(submitButton).toBeEnabled({ timeout: E2E_UI_TIMEOUT_MS });
});

test("hostile note title (emoji + zero-width + RTL) and 300+ char body round-trip without breaking layout", async ({ page }) => {
  // local-notes.ts stores the title verbatim (route schema title max 120, content max
  // 10_000) and dashboard-advanced-surface.tsx renders note.title in an <strong> and an
  // "Edit {title}" heading, and the editor inputs are value-bound to the stored fields.
  await unlockDashboard(page);
  await showAdvancedOperations(page);

  // QAzx / RTL markers kept ASCII-tokenable; length intentionally <= 120 to satisfy the API.
  const hostileTitle = "QAzx-\u0645\u0631\u062D\u0628\u0627\u200F\u202D\u{1F680}\u{1F9EA}\u200B\u202C-caf\u00E9-RTL";
  const longBody = Array.from({ length: 9 })
    .map(() => "Reconcile every open commitment and capture the exception inline")
    .join("; ");

  await page.getByPlaceholder(NOTE_TITLE_PLACEHOLDER).fill(hostileTitle);
  await page.getByPlaceholder(NOTE_BODY_PLACEHOLDER).fill(longBody);
  await page.getByRole("button", { name: "Create local note" }).click();

  await expect(page.getByText("Created a new local note.")).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS * 3 });
  // Verbatim round-trip through the store -> editor bindings.
  await expect(page.getByPlaceholder(EDITOR_TITLE_PLACEHOLDER)).toHaveValue(hostileTitle);
  await expect(page.getByPlaceholder(EDITOR_BODY_PLACEHOLDER)).toHaveValue(longBody);
  // The bidi/emoji title is echoed in a real heading, and nothing overflows the viewport.
  await expect(page.getByRole("heading", { name: /QAzx/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("very long (300+ char) goal request is accepted and keeps the dashboard layout intact", async ({ page }) => {
  // /api/goals GoalRequestSchema allows request up to 2000 chars; the composer is a
  // wrapping <textarea>, so long input must not push the page into horizontal scroll.
  await unlockDashboard(page);

  const { requestCard, requestInput } = await openRequestComposer(page);
  const longRequest = Array.from({ length: 8 })
    .map(() => "Summarize open commitments, flag blocked items, and draft the follow-ups")
    .join(" | ");

  expect(longRequest.length).toBeGreaterThan(300);
  await requestInput.fill(longRequest);
  await expect(requestInput).toHaveValue(longRequest, { timeout: E2E_UI_TIMEOUT_MS });
  await expectNoHorizontalOverflow(page);

  await submitRequest(requestCard, requestInput, longRequest);
  await expect(requestCard.locator(".status-chip.success").getByText("Created a new goal bundle.")).toBeVisible({
    timeout: E2E_UI_TIMEOUT_MS * 3
  });
  await expectNoHorizontalOverflow(page);
});

test("deep link with a bogus section and foreign item id stays bounded and never blanks the app", async ({ page }) => {
  // deep-link.tsx parseUrlState() reads section/item/panel; dashboard.tsx
  // scrollToSectionTarget() returns false when getElementById misses -> no crash,
  // no forced error, the full dashboard simply remains rendered and usable.
  await unlockDashboard(page);

  await page.goto("/?section=not-a-real-section&item=goal-does-not-exist-9999&panel=goal");

  await expect(page.getByRole("heading", { name: "Command center" })).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
  await expect(page.getByRole("button", { name: "Request work" })).toBeVisible();
  await expect(page.locator("#section-goals")).toBeVisible();
  // Bounded state: no framework crash / stack-trace-like text leaked into the page.
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toMatch(/Minified React error|Internal Server Error|Cannot read propert/u);
});

test("malformed and duplicated query strings on the dashboard still render a usable page", async ({ page }) => {
  // Unknown params (limit/cursor/sort) are ignored; duplicate `section` resolves to the
  // first value via URLSearchParams.get(); an encoded quote/angle-bracket item id fails to
  // match any anchor and is handled gracefully (see scrollToSectionTarget).
  await unlockDashboard(page);

  await page.goto("/?limit=-1&cursor=garbage&sort=%7E%2F..&section=approvals&section=now&item=%27%3E%22");

  await expect(page.getByRole("heading", { name: "Command center" })).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
  await expect(page.getByRole("button", { name: "Request work" })).toBeVisible();
  await expect(page.locator("#section-approvals")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("back/forward through SPA history after a mutation lands on explicit, reachable states", async ({ page }) => {
  // Section navigation uses pushState (deep-link updateState) and popstate re-parses the URL
  // (useDeepLink), so browser back/forward must restore rendered sections, not dead-ends or a
  // stuck "pending" composer. Selectors mirror dashboard-operating-loop.spec (passing today).
  await unlockDashboard(page);

  const { requestCard, requestInput } = await openRequestComposer(page);
  await submitRequest(requestCard, requestInput, "Review my inbox and send one external reply.");

  const operatingLoop = page.locator(".control-plane-card");
  const nowCard = operatingLoop.locator('.control-plane-section:has(strong:text-is("Now"))');
  const ownerLaneControl = operatingLoop.locator(
    '.control-plane-detail-card:has(strong:text-is("Open owner lane"))'
  );

  await expect(operatingLoop.getByRole("heading", { name: "Operating loop" })).toBeVisible();
  await ownerLaneControl.click();
  await expect(page).toHaveURL(/section=approvals/u);
  await nowCard.click();
  await expect(page).toHaveURL(/section=now/u);

  await page.goBack();
  await expect(page).toHaveURL(/section=approvals/u);
  await expect(page.locator("#section-approvals")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Command center" })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/section=now/u);
  await expect(page.locator("#section-now")).toBeVisible();

  // Not stuck mid-mutation: the composer control is interactive again.
  await expect(submitButtonOf(page)).toBeEnabled({ timeout: E2E_UI_TIMEOUT_MS });
});

test("narrow 375px viewport keeps critical actions visible/tappable with no clipped layout", async ({ page }) => {
  // Existing responsive specs cover 390/768/1440; 375 is new. The primary actions
  // ("Request work" toggle + "Lock session") must remain visible and the page must not
  // overflow horizontally at this width.
  await page.setViewportSize({ width: 375, height: 812 });
  await unlockDashboard(page);

  const requestWork = page.getByRole("button", { name: "Request work" });
  await expect(requestWork).toBeVisible();
  await expect(requestWork).toBeEnabled();
  await expect(page.getByRole("button", { name: "Lock session" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Command center" })).toBeVisible();

  await requestWork.click();
  await expect(submitButtonOf(page)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
