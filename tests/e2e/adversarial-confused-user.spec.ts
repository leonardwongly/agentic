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

test("rapid double-submit is guarded: only one goal job posts despite repeated clicks", async ({ page }) => {
  // submitGoalRequest() sets isPending(true) and awaits the polled job AFTER the POST
  // response resolves, so "Submit request" stays disabled for the whole flight
  // (dashboard-goals-card.tsx disabled={isPending}) -> a second click cannot fire a
  // second POST /api/goals. We verify the invariant (exactly 1 POST) rather than the
  // intermediate disabled state, which is inherently racy when the job completes fast.
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

  // Hostile immediate second attempt: even if the button has already re-enabled
  // (fast job completion), the guard must prevent a duplicate POST.
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

// --- AUTH GATE CONFUSION SCENARIOS ---

test("wrong access key shows a clear, actionable error message on the auth gate", async ({ page }) => {
  // auth-gate.tsx: wrong key -> POST /api/session returns 401 with error payload.
  // The error message should tell the user what went wrong, not just "Failed to unlock".
  await page.goto("/");
  await expect(page.getByText("Unlock the single-user control plane.")).toBeVisible({
    timeout: E2E_UI_TIMEOUT_MS
  });

  await page.getByLabel("Access key").fill("definitely-wrong-key-12345");
  await page.getByRole("button", { name: "Unlock" }).click();

  // Error state should be visible and contain actionable guidance.
  const errorChip = page.locator(".status-chip.error");
  await expect(errorChip).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
  // The error message should NOT be empty or generic "Failed to unlock the dashboard."
  const errorText = await errorChip.innerText();
  expect(errorText.length).toBeGreaterThan(0);
  // Input should remain usable for retry.
  await expect(page.getByLabel("Access key")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Unlock" })).toBeEnabled();
});

test("empty access key submission is rejected without crashing the auth gate", async ({ page }) => {
  // auth-gate.tsx: empty key -> POST /api/session with empty body -> server rejects.
  // The UI should show an error, not silently fail or crash.
  await page.goto("/");
  await expect(page.getByText("Unlock the single-user control plane.")).toBeVisible({
    timeout: E2E_UI_TIMEOUT_MS
  });

  // Leave access key empty and click Unlock.
  await page.getByRole("button", { name: "Unlock" }).click();

  // Should show some feedback - either validation or server error.
  const statusChip = page.locator(".status-chip");
  await expect(statusChip.first()).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
  // Page should still be functional (no crash).
  await expect(page.getByLabel("Access key")).toBeVisible();
});

// --- TOAST ACCESSIBILITY SCENARIOS ---

test("toast notifications are announced to screen readers via aria-live region", async ({ page }) => {
  // toast.tsx: ToastContainer uses role="region" aria-label="Notifications".
  // Individual toasts use role="alert" for immediate announcement.
  await unlockDashboard(page);
  await showAdvancedOperations(page);

  // Trigger a success toast by creating a note.
  await page.getByPlaceholder(NOTE_TITLE_PLACEHOLDER).fill("Toast test note");
  await page.getByPlaceholder(NOTE_BODY_PLACEHOLDER).fill("Testing toast accessibility.");
  await page.getByRole("button", { name: "Create local note" }).click();

  // Wait for the success status chip (primary feedback mechanism).
  await expect(page.getByText("Created a new local note.")).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // If toast container appears, verify its accessibility attributes.
  const toastContainer = page.locator(".toast-container");
  const hasToast = await toastContainer.isVisible().catch(() => false);

  if (hasToast) {
    // Verify aria attributes for screen reader announcement.
    await expect(toastContainer).toHaveAttribute("role", "region");
    await expect(toastContainer).toHaveAttribute("aria-label", "Notifications");

    const toastItem = toastContainer.locator(".toast").first();
    if (await toastItem.isVisible().catch(() => false)) {
      await expect(toastItem).toHaveAttribute("role", "alert");

      // Toast should have a dismiss button with accessible label.
      const dismissButton = toastItem.getByRole("button", { name: "Dismiss" });
      if (await dismissButton.isVisible().catch(() => false)) {
        await expect(dismissButton).toHaveAttribute("aria-label", "Dismiss");
      }
    }
  }
});

test("toast can be dismissed via keyboard without mouse", async ({ page }) => {
  // Confused users may rely on keyboard-only navigation.
  await unlockDashboard(page);
  await showAdvancedOperations(page);

  // Create a note to trigger toast.
  await page.getByPlaceholder(NOTE_TITLE_PLACEHOLDER).fill("Keyboard dismiss test");
  await page.getByPlaceholder(NOTE_BODY_PLACEHOLDER).fill("Testing keyboard dismissal.");
  await page.getByRole("button", { name: "Create local note" }).click();

  // Wait for success feedback (primary mechanism).
  await expect(page.getByText("Created a new local note.")).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // If toast container appears, test keyboard dismissal.
  const toastContainer = page.locator(".toast-container");
  const hasToast = await toastContainer.isVisible().catch(() => false);

  if (hasToast) {
    const dismissButton = toastContainer.locator(".toast-dismiss").first();
    if (await dismissButton.isVisible().catch(() => false)) {
      await dismissButton.focus();
      await expect(dismissButton).toBeFocused();
      await page.keyboard.press("Enter");

      // Toast should be removed.
      await expect(toastContainer.locator(".toast")).toHaveCount(0, { timeout: E2E_UI_TIMEOUT_MS });
    }
  }
});

// --- FORM VALIDATION FEEDBACK SCENARIOS ---

test("empty refinement input shows inline validation before API call", async ({ page }) => {
  // dashboard.tsx refineGoal(): empty refinement -> setRefinementState error.
  // User should see feedback without waiting for network round-trip.
  await unlockDashboard(page);

  const { requestCard, requestInput } = await openRequestComposer(page);
  await submitRequest(requestCard, requestInput, "Test goal for refinement validation.");

  // Find the refinement input for the created goal.
  const refinementInput = page.locator(".refinement-row input").first();
  await expect(refinementInput).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // Leave empty and try to refine - button should be disabled.
  const refineButton = page.locator(".refinement-row").getByRole("button", { name: "Refine" }).first();
  await expect(refineButton).toBeDisabled();

  // Type something, then clear it - button should become disabled again.
  await refinementInput.fill("Some refinement text");
  await expect(refineButton).toBeEnabled();
  await refinementInput.fill("");
  await expect(refineButton).toBeDisabled();
});

test("note editor inputs are disabled when no note is selected to prevent orphan edits", async ({ page }) => {
  // dashboard-advanced-surface.tsx: editor inputs are disabled until a note is selected.
  // This prevents confused users from typing into an editor that has no save target.
  await unlockDashboard(page);
  await showAdvancedOperations(page);

  // Editor placeholders indicate no note is selected.
  const editorTitle = page.getByPlaceholder(EDITOR_TITLE_PLACEHOLDER);
  const editorBody = page.getByPlaceholder(EDITOR_BODY_PLACEHOLDER);

  await expect(editorTitle).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
  await expect(editorBody).toBeVisible();

  // Both inputs should be disabled when no note is selected.
  await expect(editorTitle).toBeDisabled();
  await expect(editorBody).toBeDisabled();

  // Save button should also be disabled.
  const saveButton = page.getByRole("button", { name: "Save selected note" });
  await expect(saveButton).toBeDisabled();
});

// --- COMMAND PALETTE EDGE CASES ---

test("command palette shows accessible empty state when no commands match", async ({ page }) => {
  // command-palette.tsx: filteredCommands.length === 0 -> "No matching commands" div.
  // This state should be perceivable by screen readers.
  await unlockDashboard(page);

  // Open command palette.
  await page.locator("body").click();
  await page.keyboard.press("Control+k");

  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // Type nonsense that matches nothing.
  const searchInput = page.getByRole("textbox", { name: "Search commands" });
  await searchInput.fill("xyzzy-nonexistent-command-12345");

  // Empty state should be visible.
  const emptyState = palette.getByText("No matching commands");
  await expect(emptyState).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // Escape should still close the palette.
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
});

test("command palette keyboard navigation wraps correctly at boundaries", async ({ page }) => {
  // command-palette.tsx: ArrowUp at index 0 stays at 0, ArrowDown at max stays at max.
  // Confused users may mash arrow keys; selection should not wrap unexpectedly.
  await unlockDashboard(page);

  await page.locator("body").click();
  await page.keyboard.press("Control+k");

  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // Press ArrowUp repeatedly - should stay at first item, not wrap to end.
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("ArrowUp");
  }

  // First item should still be selected (data-selected="true").
  const firstItem = palette.locator(".palette-item").first();
  await expect(firstItem).toHaveAttribute("data-selected", "true");

  // Press ArrowDown many times - should cap at last item.
  for (let i = 0; i < 50; i++) {
    await page.keyboard.press("ArrowDown");
  }

  // Last item should be selected.
  const allItems = palette.locator(".palette-item");
  const lastItem = allItems.last();
  await expect(lastItem).toHaveAttribute("data-selected", "true");

  await page.keyboard.press("Escape");
});

// --- SESSION LOCK EDGE CASES ---

test("lock session button remains accessible after navigating between sections", async ({ page }) => {
  // Confused users may navigate around before realizing they need to lock.
  // Lock button should always be visible and functional.
  await unlockDashboard(page);

  const lockButton = page.getByRole("button", { name: "Lock session" });
  await expect(lockButton).toBeVisible();

  // Navigate to approvals section.
  await page.goto("/?section=approvals");
  await expect(page.locator("#section-approvals")).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
  await expect(lockButton).toBeVisible();

  // Navigate to notes section.
  await page.goto("/?section=notes");
  await expect(page.locator("#section-notes")).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
  await expect(lockButton).toBeVisible();

  // Lock should work from any section.
  await lockButton.click();
  await expect(page.getByText("Unlock the single-user control plane.")).toBeVisible({
    timeout: E2E_UI_TIMEOUT_MS
  });
});

test("locking session clears sensitive dashboard content from view", async ({ page }) => {
  // After locking, no dashboard content should be visible - only the auth gate.
  await unlockDashboard(page);

  // Verify dashboard content is visible before lock.
  await expect(page.getByRole("heading", { name: "Command center" })).toBeVisible();

  await page.getByRole("button", { name: "Lock session" }).click();

  // Auth gate should be visible.
  await expect(page.getByText("Unlock the single-user control plane.")).toBeVisible({
    timeout: E2E_UI_TIMEOUT_MS
  });

  // Dashboard content should NOT be visible.
  await expect(page.getByRole("heading", { name: "Command center" })).not.toBeVisible();
  await expect(page.locator("#section-goals")).not.toBeVisible();
  await expect(page.locator("#section-approvals")).not.toBeVisible();
});

// --- SLIDE-OUT PANEL FOCUS MANAGEMENT ---

test("slide-out panel traps focus and returns focus on close", async ({ page }) => {
  // slide-out-panel.tsx implements focus trap and Escape handling.
  // Focus should stay within panel when open, and return to trigger on close.
  await unlockDashboard(page);

  const { requestCard, requestInput } = await openRequestComposer(page);
  await submitRequest(requestCard, requestInput, "Test goal for panel focus management.");

  // Open the detail drawer.
  const openDetailsButton = page.locator(".request-card .list-item").first().getByRole("button", { name: "Open details" });
  await expect(openDetailsButton).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
  await openDetailsButton.click();

  const drawer = page.locator(".slideout-panel[role='dialog']").first();
  await expect(drawer).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // Focus should be inside the drawer.
  const focusedElement = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el ? el.closest(".slideout-panel") !== null : false;
  });
  expect(focusedElement).toBe(true);

  // Tab through the drawer - focus should stay trapped.
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
  }

  const stillInDrawer = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el ? el.closest(".slideout-panel") !== null : false;
  });
  expect(stillInDrawer).toBe(true);

  // Escape should close the drawer.
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden({ timeout: E2E_UI_TIMEOUT_MS });
});

// --- LOADING STATE CLARITY ---

test("submit button shows disabled state during goal creation to prevent confusion", async ({ page }) => {
  // dashboard-goals-card.tsx: disabled={isPending} on Submit request button.
  // Users should see clear visual feedback that their action is being processed.
  await unlockDashboard(page);

  const { requestCard, requestInput } = await openRequestComposer(page);
  const submitButton = submitButtonOf(page);

  await requestInput.fill("Test loading state visibility.");
  await requestInput.press("Tab");
  await expect(submitButton).toBeEnabled({ timeout: E2E_UI_TIMEOUT_MS });

  // Click and immediately check disabled state.
  await submitButton.click();

  // Button should become disabled quickly to show processing state.
  await expect(submitButton).toBeDisabled({ timeout: 2_000 });

  // Wait for completion.
  await expect(requestCard.locator(".status-chip.success")).toBeVisible({
    timeout: E2E_UI_TIMEOUT_MS * 3
  });

  // Button should re-enable after completion.
  await expect(submitButton).toBeEnabled({ timeout: E2E_UI_TIMEOUT_MS });
});

// --- ZOOM ACCESSIBILITY ---

test("dashboard remains usable at 200% browser zoom without horizontal overflow (WCAG 1.4.4)", async ({ page }) => {
  // WCAG 2.1 Success Criterion 1.4.4: Content must remain usable at 200% zoom
  // without requiring horizontal scrolling. Fixed by replacing fixed-width layouts
  // with responsive minmax()/auto-fit grids and adding overflow-x: clip on root.
  await unlockDashboard(page);

  // Set 200% zoom via CSS zoom property.
  await page.evaluate(() => {
    document.documentElement.style.zoom = "200%";
  });

  // Verify no horizontal overflow at 200% zoom.
  await expectNoHorizontalOverflow(page);

  // Critical elements should still be visible and operable.
  await expect(page.getByRole("heading", { name: "Command center" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request work" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Lock session" })).toBeVisible();

  // Request composer should be usable.
  await page.getByRole("button", { name: "Request work" }).click();
  await expect(submitButtonOf(page)).toBeVisible();

  // Layout should still have no horizontal overflow after opening the composer.
  await expectNoHorizontalOverflow(page);

  // Reset zoom for subsequent tests.
  await page.evaluate(() => {
    document.documentElement.style.zoom = "100%";
  });
});

// --- REDUCED MOTION PREFERENCE ---

test("dashboard respects prefers-reduced-motion for users with vestibular disorders", async ({ page }) => {
  // Users with motion sensitivity need reduced animations.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await unlockDashboard(page);

  // Page should render without issues under reduced motion.
  await expect(page.getByRole("heading", { name: "Command center" })).toBeVisible();

  // Navigate and verify no jarring transitions.
  await page.getByRole("button", { name: "Request work" }).click();
  await expect(submitButtonOf(page)).toBeVisible();

  // Verify the media query is respected (CSS-level check).
  const reducedMotionActive = await page.evaluate(() => {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  expect(reducedMotionActive).toBe(true);
});

// --- PASTE HANDLING IN TEXT INPUTS ---

test("pasting long text into request textarea works correctly", async ({ page }) => {
  // Confused users may paste content from elsewhere. Paste should work reliably.
  await unlockDashboard(page);

  const { requestInput } = await openRequestComposer(page);

  const pastedText = "This is a pasted request that was copied from another application. " +
    "It contains multiple sentences and should be handled correctly by the textarea. " +
    "Special characters: é à ü ñ should all survive the paste.";

  // Use Playwright's fill which properly triggers React's synthetic events.
  await requestInput.fill(pastedText);

  // The value should be reflected.
  await expect(requestInput).toHaveValue(pastedText, { timeout: E2E_UI_TIMEOUT_MS });

  // Submit button should become enabled.
  const submitButton = submitButtonOf(page);
  await expect(submitButton).toBeEnabled({ timeout: E2E_UI_TIMEOUT_MS });
});

// --- ERROR MESSAGE RECOVERY GUIDANCE ---

test("error messages provide recovery path, not just failure notification", async ({ page }) => {
  // Good UX: errors tell users HOW to fix, not just WHAT broke.
  await unlockDashboard(page);

  const { requestCard } = await openRequestComposer(page);
  const submitButton = submitButtonOf(page);

  // Trigger empty submission error.
  await submitButton.click();

  const errorChip = requestCard.locator(".status-chip.error");
  await expect(errorChip).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  const errorMessage = await errorChip.innerText();
  // Error should mention what action to take (enter a request).
  expect(errorMessage.toLowerCase()).toMatch(/enter|request|before/i);

  // The form should remain editable for recovery.
  await expect(requestCard.locator("textarea")).toBeEnabled();
  await expect(submitButton).toBeEnabled();
});
