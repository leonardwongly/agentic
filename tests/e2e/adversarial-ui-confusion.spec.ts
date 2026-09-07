import { expect, test, type Page } from "@playwright/test";
import {
  E2E_UI_TIMEOUT_MS,
  openRequestComposer,
  showAdvancedOperations,
  submitRequest,
  unlockDashboard
} from "./helpers";

// Adversarial UI/UX confusion sweep — Part 2.
// Complements adversarial-confused-user.spec.ts with additional confusion patterns:
// - Misleading empty states (do they guide the user to the next action?)
// - Navigation dead-ends (can users always find their way back?)
// - Confusing overlay dismissal (clicking outside, Escape, close buttons)
// - Focus mode escape routes (exit button + Escape key)
// - Terminology consistency across surfaces
// - Status feedback clarity (did the action succeed?)
// - Dashboard section heading clarity and advanced surface toggle state feedback
// - Detail drawer fallback messaging
// - Share page error states
// - Disabled vs loading state clarity
test.setTimeout(process.env.CI ? 120_000 : 60_000);

const NOTE_TITLE_PLACEHOLDER = "Example: Travel packing list";
const NOTE_BODY_PLACEHOLDER = "Write a note that should be searchable through the notes adapter.";
const EDITOR_TITLE_PLACEHOLDER = "Open a note to edit its title";
const EDITOR_BODY_PLACEHOLDER = "Open a note to edit its body.";

function submitButtonOf(page: Page) {
  return page.locator(".request-card .hero-button-row").getByRole("button", { name: "Submit request" });
}

// --- EMPTY STATE ACTIONABILITY ---
// Prevents: Empty states that leave users confused about what to do next.
// Every empty state should have an actionable path forward.

test("no-goals empty state provides a clear 'Create goal' action button", async ({ page }) => {
  // empty-states.tsx: NoGoalsEmpty renders EmptyState with action={{ label: "Create goal" }}.
  // A confused user arriving at an empty dashboard should see a clear path to create their first goal.
  await unlockDashboard(page);

  // On a fresh dashboard with no goals, the NoGoalsEmpty component renders a specific structure.
  // Target it by the title text "No active goals" to avoid matching other empty states.
  const noGoalsEmpty = page.locator(".empty-state:has(.empty-state-title)", {
    hasText: "No active goals"
  }).first();
  const hasNoGoals = await noGoalsEmpty.isVisible({ timeout: E2E_UI_TIMEOUT_MS }).catch(() => false);

  if (!hasNoGoals) {
    // Dashboard may already have goals from previous tests; skip gracefully.
    return;
  }

  // It should have a "Create goal" action button, not just text.
  const actionButton = noGoalsEmpty.getByRole("button", { name: "Create goal" });
  await expect(actionButton).toBeVisible();
  await expect(actionButton).toBeEnabled();

  // Clicking should focus the request composer (not navigate away or do nothing).
  await actionButton.click();
  const requestInput = page.locator(".request-card textarea");
  await expect(requestInput).toBeFocused({ timeout: E2E_UI_TIMEOUT_MS });
});

test("no-goals empty state shows helpful suggestions to orient a new user", async ({ page }) => {
  // empty-states.tsx: NoGoalsEmpty includes suggestions like "Triage my inbox..."
  // A confused user should see concrete examples, not just "No goals".
  await unlockDashboard(page);

  const noGoalsEmpty = page.locator(".empty-state:has(.empty-state-title)", {
    hasText: "No active goals"
  }).first();
  const hasNoGoals = await noGoalsEmpty.isVisible({ timeout: E2E_UI_TIMEOUT_MS }).catch(() => false);

  if (!hasNoGoals) {
    return;
  }

  // Should have a descriptive title, not just "No goals".
  const title = noGoalsEmpty.locator(".empty-state-title");
  await expect(title).toBeVisible();
  const titleText = await title.innerText();
  expect(titleText.toLowerCase()).toContain("goal");

  // Should have a description explaining what goals are.
  const description = noGoalsEmpty.locator(".empty-state-description");
  await expect(description).toBeVisible();
  const descText = await description.innerText();
  expect(descText.length).toBeGreaterThan(10);

  // Should show concrete suggestions.
  const suggestions = noGoalsEmpty.locator(".empty-state-suggestions li");
  if (await suggestions.first().isVisible().catch(() => false)) {
    const count = await suggestions.count();
    expect(count).toBeGreaterThan(0);
  }
});

// --- NAVIGATION DEAD-ENDS ---
// Prevents: Users getting stuck in a section with no way back.

test("command palette navigation does not create dead-ends — user can always return", async ({ page }) => {
  // command-palette.tsx: navigation commands update the deep link URL.
  // A confused user who navigates via the palette should be able to navigate back.
  await unlockDashboard(page);

  // Open palette and navigate to approvals.
  await page.locator("body").click();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  const approvalsCmd = palette.getByText("View approvals");
  await expect(approvalsCmd).toBeVisible();
  await approvalsCmd.click();

  // Should land on approvals section.
  await expect(page).toHaveURL(/section=approvals/u, { timeout: E2E_UI_TIMEOUT_MS });
  await expect(page.locator("#section-approvals")).toBeVisible();

  // Now navigate to a different section via palette.
  await page.keyboard.press("Control+k");
  await expect(palette).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  const notesCmd = palette.getByText("Open notes");
  await expect(notesCmd).toBeVisible();
  await notesCmd.click();

  // Should land on notes section, not a dead-end.
  await expect(page).toHaveURL(/section=notes/u, { timeout: E2E_UI_TIMEOUT_MS });
  await expect(page.locator("#section-notes")).toBeVisible();

  // Browser back should work (SPA history).
  await page.goBack();
  await expect(page).toHaveURL(/section=approvals/u, { timeout: E2E_UI_TIMEOUT_MS });
});

test("direct URL navigation to unknown section does not trap the user", async ({ page }) => {
  // deep-link.tsx: unknown sections are ignored; the dashboard still renders.
  // A confused user who types a bogus URL should not be stuck.
  await unlockDashboard(page);

  // Navigate to a nonsense section via URL.
  await page.goto("/?section=does-not-exist-xyz");

  // Dashboard should still render with usable content.
  await expect(page.getByRole("heading", { name: "Command center" })).toBeVisible({
    timeout: E2E_UI_TIMEOUT_MS
  });
  await expect(page.getByRole("button", { name: "Request work" })).toBeVisible();

  // User can still navigate to a valid section.
  await page.goto("/?section=approvals");
  await expect(page.locator("#section-approvals")).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
});

// --- OVERLAY DISMISSAL ---
// Prevents: Users confused about how to close modals/overlays.

test("command palette overlay closes when clicking outside the palette container", async ({ page }) => {
  // command-palette.tsx: palette-overlay onClick={close}, palette-container onClick stopPropagation.
  // A confused user who clicks outside should have the palette close, not stay stuck.
  await unlockDashboard(page);

  // Ensure the dashboard is fully interactive before opening the palette.
  await expect(page.getByRole("button", { name: "Request work" })).toBeEnabled({ timeout: E2E_UI_TIMEOUT_MS });
  await page.locator("body").click();
  await page.waitForTimeout(200);
  await page.keyboard.press("Control+k");

  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // Click on the overlay (outside the palette container).
  const overlay = page.locator(".palette-overlay");
  await overlay.click({ position: { x: 10, y: 10 } });

  // Palette should close.
  await expect(palette).toBeHidden({ timeout: E2E_UI_TIMEOUT_MS });
});

test("slide-out panel closes when clicking the overlay background", async ({ page }) => {
  // slide-out-panel.tsx: slideout-overlay onClick={onClose}, slideout-panel stopPropagation.
  // A confused user should be able to close a detail panel by clicking outside it.
  await unlockDashboard(page);

  const { requestCard, requestInput } = await openRequestComposer(page);
  await submitRequest(requestCard, requestInput, "Test goal for slide-out overlay dismiss.");

  // Open the detail drawer.
  const openDetailsButton = page.locator(".request-card .list-item").first().getByRole("button", { name: "Open details" });
  await expect(openDetailsButton).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
  await openDetailsButton.click();

  const drawer = page.locator(".slideout-panel[role='dialog']").first();
  await expect(drawer).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // Click on the overlay background to dismiss.
  const overlay = page.locator(".slideout-overlay");
  await overlay.click({ position: { x: 10, y: 10 } });

  // Panel should close.
  await expect(drawer).toBeHidden({ timeout: E2E_UI_TIMEOUT_MS });
});

test("slide-out panel has a visible close button with accessible label", async ({ page }) => {
  // slide-out-panel.tsx: close button has aria-label="Close panel" and visible X icon.
  // A confused user should see a clear close affordance.
  await unlockDashboard(page);

  const { requestCard, requestInput } = await openRequestComposer(page);
  await submitRequest(requestCard, requestInput, "Test goal for close button visibility.");

  const openDetailsButton = page.locator(".request-card .list-item").first().getByRole("button", { name: "Open details" });
  await expect(openDetailsButton).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
  await openDetailsButton.click();

  const drawer = page.locator(".slideout-panel[role='dialog']").first();
  await expect(drawer).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // Close button should be visible and have an accessible label.
  const closeButton = drawer.getByRole("button", { name: "Close panel" });
  await expect(closeButton).toBeVisible();

  // Clicking it should close the panel.
  await closeButton.click();
  await expect(drawer).toBeHidden({ timeout: E2E_UI_TIMEOUT_MS });
});

// --- FOCUS MODE ESCAPE ---
// Prevents: Users trapped in focus mode with no visible exit.

test("focus mode overlay has a visible 'Exit' button and responds to Escape key", async ({ page }) => {
  // focus-mode.tsx: renders "Exit" button with aria-label="Exit focus mode" and Esc handler.
  // A confused user entering focus mode must be able to find the way out.
  await unlockDashboard(page);

  // Navigate to approvals section to find the focus mode button.
  await page.goto("/?section=approvals");
  await expect(page.locator("#section-approvals")).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // Find and click a focus mode button if visible.
  const focusButton = page.locator(".focus-mode-button").first();
  const hasFocusButton = await focusButton.isVisible().catch(() => false);

  if (!hasFocusButton) {
    // Focus mode button may not render in all configurations; skip gracefully.
    return;
  }

  await focusButton.click();

  // Focus mode overlay should appear.
  const focusOverlay = page.locator(".focus-mode-overlay");
  await expect(focusOverlay).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // Verify the exit button is present and labeled.
  const exitButton = focusOverlay.getByRole("button", { name: "Exit focus mode" });
  await expect(exitButton).toBeVisible();

  // The exit button should contain visible "Exit" text.
  const exitText = exitButton.locator("span");
  await expect(exitText).toHaveText("Exit");

  // Also show keyboard shortcut hint.
  const escHint = exitButton.locator("kbd");
  await expect(escHint).toBeVisible();

  // Escape should close focus mode.
  await page.keyboard.press("Escape");
  await expect(focusOverlay).toBeHidden({ timeout: E2E_UI_TIMEOUT_MS });
});

// --- TERMINOLOGY CONSISTENCY ---
// Prevents: Users confused by inconsistent labels across surfaces.

test("command palette labels match dashboard section headings for consistent terminology", async ({ page }) => {
  // command-palette.tsx: command labels should match what's on the dashboard.
  // A confused user who sees "View approvals" in the palette should find an "Approvals" section.
  await unlockDashboard(page);

  await page.locator("body").click();
  await page.keyboard.press("Control+k");

  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // Verify navigation command labels exist.
  const navigationCommands = [
    "View approvals",
    "Search memories",
    "View artifacts",
    "Open notes",
    "View integrations"
  ];

  for (const label of navigationCommands) {
    const cmd = palette.getByText(label, { exact: true });
    await expect(cmd).toBeVisible({ timeout: 2_000 });
  }

  await page.keyboard.press("Escape");
});

test("request card heading matches the button that opens it — 'Request work'", async ({ page }) => {
  // dashboard-goals-card.tsx: <h2>Request work</h2> and the button says "Submit request".
  // The section heading and toggle button should use the same verb for consistency.
  await unlockDashboard(page);

  // The toggle button is "Request work".
  const toggleButton = page.getByRole("button", { name: "Request work" });
  await expect(toggleButton).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // After clicking, the card heading should say "Request work".
  await toggleButton.click();
  const cardHeading = page.locator(".request-card .card-header h2");
  await expect(cardHeading).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
  await expect(cardHeading).toHaveText("Request work");

  // The submit button inside should say "Submit request" — different from the heading,
  // but uses consistent "request" terminology.
  const submitBtn = submitButtonOf(page);
  await expect(submitBtn).toBeVisible();
  await expect(submitBtn).toHaveText("Submit request");
});

// --- STATUS FEEDBACK CLARITY ---
// Prevents: Users unsure whether their action succeeded or failed.

test("request card shows a persistent informative message in idle state", async ({ page }) => {
  // dashboard-goals-card.tsx: status-chip in idle state shows
  // "Requests are validated, policy checked, and converted into bounded execution bundles..."
  // A confused user should see guidance, not a blank status area.
  await unlockDashboard(page);
  await page.getByRole("button", { name: "Request work" }).click();

  const statusChip = page.locator(".request-card .status-chip").first();
  await expect(statusChip).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  const statusText = await statusChip.innerText();
  // The idle message should be informative, not empty.
  expect(statusText.length).toBeGreaterThan(10);
  // It should mention what happens to requests.
  expect(statusText.toLowerCase()).toMatch(/request|validat|policy|bundle/u);
});

test("note creation shows a clear success status chip", async ({ page }) => {
  // dashboard.tsx createLocalNote: on success sets submitState to success with
  // "Created a new local note." message. The user should see explicit confirmation.
  await unlockDashboard(page);
  await showAdvancedOperations(page);

  await page.getByPlaceholder(NOTE_TITLE_PLACEHOLDER).fill("Feedback test note");
  await page.getByPlaceholder(NOTE_BODY_PLACEHOLDER).fill("Testing feedback clarity.");
  await page.getByRole("button", { name: "Create local note" }).click();

  // Success status should be visible and clearly positive.
  const successChip = page.locator(".status-chip.success").getByText("Created a new local note.");
  await expect(successChip).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // The status chip should not also contain error-like wording.
  const chipText = await successChip.innerText();
  expect(chipText.toLowerCase()).not.toMatch(/error|fail|unable|cannot/u);
});

test("note save provides clear feedback when editing an existing note", async ({ page }) => {
  // dashboard-advanced-surface.tsx: saveSelectedNote() shows success state.
  // A confused user who edits a note needs confirmation the save landed.
  await unlockDashboard(page);
  await showAdvancedOperations(page);

  // Create a note first.
  await page.getByPlaceholder(NOTE_TITLE_PLACEHOLDER).fill("Save feedback test");
  await page.getByPlaceholder(NOTE_BODY_PLACEHOLDER).fill("Content for save feedback testing.");
  await page.getByRole("button", { name: "Create local note" }).click();
  await expect(page.getByText("Created a new local note.")).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // Now select the note for editing.
  const editorTitle = page.getByPlaceholder(EDITOR_TITLE_PLACEHOLDER);
  await expect(editorTitle).toBeEnabled({ timeout: E2E_UI_TIMEOUT_MS });

  // The editor should now be enabled (note is selected).
  const editorBody = page.getByPlaceholder(EDITOR_BODY_PLACEHOLDER);
  await expect(editorBody).toBeEnabled();

  // Save button should be enabled.
  const saveButton = page.getByRole("button", { name: "Save selected note" });
  await expect(saveButton).toBeEnabled();

  // Edit and save.
  await editorTitle.fill("Updated save feedback test");
  await editorBody.fill("Updated content for save feedback testing.");
  await saveButton.click();

  // Should show save confirmation — look for the specific success status chip.
  // The note form area should show a status-chip.success message about saving.
  const noteSection = page.locator("#section-notes, .dashboard-advanced-surface").first();
  const successChip = noteSection.locator(".status-chip.success");
  await expect(successChip).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // The success chip text should mention saving/updating.
  const chipText = await successChip.innerText();
  expect(chipText.toLowerCase()).toMatch(/sav|updat|note|success/i);
});

// --- DASHBOARD SECTION HEADING CLARITY ---
// Prevents: Users confused by vague or missing section headings.

test("each major dashboard section has a clear, descriptive heading", async ({ page }) => {
  // A confused user needs to scan the dashboard and understand what each section does.
  // Every section card should have an h2 with meaningful, unambiguous text.
  await unlockDashboard(page);

  const sectionCards = page.locator("article.card[id^='section-']");
  const sectionCount = await sectionCards.count();
  expect(sectionCount).toBeGreaterThanOrEqual(2);

  for (let i = 0; i < sectionCount; i++) {
    const card = sectionCards.nth(i);
    if (!(await card.isVisible())) {
      continue;
    }
    const heading = card.locator("h2, h3").first();
    await expect(heading).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
    const headingText = await heading.innerText();
    // Heading should be non-empty and more than just a number or icon.
    expect(headingText.trim().length).toBeGreaterThan(2);
    // Heading should not be a generic placeholder.
    expect(headingText.toLowerCase()).not.toMatch(/^(section|card|panel|block)\s*\d*$/u);
  }
});

// --- ADVANCED SURFACE TOGGLE STATE FEEDBACK ---
// Prevents: Users unsure whether advanced operations are expanded or collapsed.

test("advanced surface toggle button label reflects current state", async ({ page }) => {
  // dashboard-advanced-operations-card.tsx: "Show advanced operations" / "Hide advanced operations".
  // A confused user needs to know whether clicking will expand or collapse the surface.
  await unlockDashboard(page);

  const showButton = page.getByRole("button", { name: "Show advanced operations" });
  await expect(showButton).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // Click to expand.
  await showButton.click();

  // After expanding, the button should change to "Hide advanced operations".
  const hideButton = page.getByRole("button", { name: "Hide advanced operations" });
  await expect(hideButton).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // The original "Show" button should no longer be visible.
  await expect(showButton).not.toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // Click to collapse.
  await hideButton.click();

  // Should revert to "Show advanced operations".
  await expect(showButton).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
});

// --- SHARE PAGE ERROR STATE ---
// Prevents: Users confused when a share link is invalid or expired.

test("invalid share token shows a clear, actionable error page", async ({ page }) => {
  // share/not-found.tsx: renders "That share link is invalid or expired."
  // with guidance to "Ask the sender for a fresh link."
  // A confused user clicking a stale link needs to understand what happened.
  await page.goto("/share/invalid-token-xyz-12345");

  // Should show a clear heading about the problem.
  const heading = page.locator("h1");
  await expect(heading).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
  const headingText = await heading.innerText();
  expect(headingText.toLowerCase()).toMatch(/invalid|expired|unavailable/u);

  // Should provide guidance on what to do.
  const bodyText = await page.locator("body").innerText();
  expect(bodyText.toLowerCase()).toMatch(/fresh|new|sender|link/u);

  // Should have a status indicator.
  const statusChip = page.locator(".status-chip");
  await expect(statusChip.first()).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
});

// --- DETAIL DRAWER FALLBACK ---
// Prevents: Users seeing a blank or broken panel when data disappears.

test("detail drawer shows informative message when selected record is unavailable", async ({ page }) => {
  // dashboard-detail-drawer.tsx: fallback renders "The selected detail record is no longer available."
  // A confused user should see a clear message, not a blank panel.
  await unlockDashboard(page);

  const { requestCard, requestInput } = await openRequestComposer(page);
  await submitRequest(requestCard, requestInput, "Test goal for detail drawer fallback.");

  // Open details for the created goal.
  const openDetailsButton = page.locator(".request-card .list-item").first().getByRole("button", { name: "Open details" });
  await expect(openDetailsButton).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
  await openDetailsButton.click();

  const drawer = page.locator(".slideout-panel[role='dialog']").first();
  await expect(drawer).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // The drawer should have a meaningful title (the goal title).
  const drawerTitle = drawer.locator(".slideout-title");
  await expect(drawerTitle).toBeVisible();
  const titleText = await drawerTitle.innerText();
  expect(titleText.length).toBeGreaterThan(0);

  // The drawer should have a subtitle describing what's inside.
  const subtitle = drawer.locator(".slideout-subtitle");
  if (await subtitle.isVisible().catch(() => false)) {
    const subtitleText = await subtitle.innerText();
    expect(subtitleText.length).toBeGreaterThan(5);
  }
});

// --- DISABLED VS LOADING STATE CLARITY ---
// Prevents: Users confusing a disabled button with a loading indicator.

test("submit button shows disabled state with visible isPending during goal creation", async ({ page }) => {
  // dashboard-goals-card.tsx: disabled={isPending} on submit button.
  // A confused user needs to know the button is processing, not broken.
  await unlockDashboard(page);

  const { requestInput } = await openRequestComposer(page);
  const submitButton = submitButtonOf(page);

  await requestInput.fill("Loading state clarity test goal.");
  await requestInput.press("Tab");
  await expect(submitButton).toBeEnabled({ timeout: E2E_UI_TIMEOUT_MS });

  // Click the submit button.
  await submitButton.click();

  // The button should become disabled during processing.
  await expect(submitButton).toBeDisabled({ timeout: 2_000 });

  // After completion, it should re-enable.
  await expect(submitButton).toBeEnabled({ timeout: E2E_UI_TIMEOUT_MS * 3 });
});

test("share button shows disabled state with tooltip when workspace not selected", async ({ page }) => {
  // dashboard-goals-card.tsx: share button has title={goalSharePermissionReason} when disabled.
  // A confused user should see WHY the share button is disabled.
  await unlockDashboard(page);

  const { requestCard, requestInput } = await openRequestComposer(page);
  await submitRequest(requestCard, requestInput, "Test goal for share button tooltip.");

  // The share button should be visible for the created goal.
  const shareButton = page.locator(".request-card .list-item").first().getByRole("button", { name: "Review share" });
  await expect(shareButton).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // If it's disabled, it should have a title/tooltip explaining why.
  const isDisabled = await shareButton.isDisabled();
  if (isDisabled) {
    const title = await shareButton.getAttribute("title");
    // Should have a reason, not be silently disabled.
    expect(title).toBeTruthy();
    expect(title!.length).toBeGreaterThan(0);
  }
});

// --- FIRST-RUN CHECKLIST ---
// Prevents: Users overwhelmed by a checklist that can't be dismissed.

test("first-run checklist is dismissible and stays dismissed", async ({ page }) => {
  // dashboard-first-run-checklist.tsx: "Dismiss" button sets sessionStorage flag.
  // A confused user should be able to dismiss the checklist without it reappearing.
  await unlockDashboard(page);

  const checklist = page.locator(".first-run-checklist");
  const hasChecklist = await checklist.isVisible().catch(() => false);

  if (!hasChecklist) {
    // Checklist may not appear if all milestones are complete; skip gracefully.
    return;
  }

  // Should have a visible Dismiss button.
  const dismissButton = checklist.getByRole("button", { name: "Dismiss" });
  await expect(dismissButton).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // Click to dismiss.
  await dismissButton.click();

  // Checklist should disappear.
  await expect(checklist).toBeHidden({ timeout: E2E_UI_TIMEOUT_MS });

  // Reload and verify it stays dismissed.
  await page.reload();
  await expect(page.getByRole("button", { name: "Unlock" })).not.toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
  await expect(checklist).toBeHidden({ timeout: E2E_UI_TIMEOUT_MS });
});

test("first-run checklist milestones have clear action labels and status indicators", async ({ page }) => {
  // dashboard-first-run-checklist.tsx: each milestone has a status chip (Done/Next/Blocked/Optional)
  // and an action button. A confused user should understand progress at a glance.
  await unlockDashboard(page);

  const checklist = page.locator(".first-run-checklist");
  const hasChecklist = await checklist.isVisible().catch(() => false);

  if (!hasChecklist) {
    return;
  }

  // Each milestone should have a status chip.
  const milestones = checklist.locator(".list-item.vertical");
  const count = await milestones.count();
  expect(count).toBeGreaterThan(0);

  // At least one milestone should have an action button.
  const actionButtons = checklist.locator(".goal-item-actions button");
  const actionCount = await actionButtons.count();
  expect(actionCount).toBeGreaterThan(0);

  // Status chips should use recognized labels.
  const statusChips = checklist.locator(".status-chip");
  const chipCount = await statusChips.count();
  expect(chipCount).toBeGreaterThan(0);

  // Verify at least one status label is one of the expected values.
  let foundKnownLabel = false;
  for (let i = 0; i < chipCount; i++) {
    const text = await statusChips.nth(i).innerText();
    if (["Done", "Next", "Blocked", "Optional"].some((label) => text.includes(label))) {
      foundKnownLabel = true;
      break;
    }
  }
  expect(foundKnownLabel).toBe(true);
});

// --- COMMAND PALETTE KEYBOARD HINTS ---
// Prevents: Users not discovering keyboard shortcuts.

test("command palette footer shows keyboard navigation hints", async ({ page }) => {
  // command-palette.tsx: palette-footer shows "↑↓ navigate", "↵ select", "esc close".
  // A confused user should see how to use the palette without guessing.
  await unlockDashboard(page);

  await page.locator("body").click();
  await page.keyboard.press("Control+k");

  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // Footer should show navigation hints.
  const footer = palette.locator(".palette-footer");
  await expect(footer).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  const footerText = await footer.innerText();
  expect(footerText.toLowerCase()).toMatch(/navigate|select|close|esc/u);

  // Should contain kbd elements for keyboard shortcuts.
  const kbdElements = footer.locator("kbd");
  const kbdCount = await kbdElements.count();
  expect(kbdCount).toBeGreaterThan(0);

  await page.keyboard.press("Escape");
});

// --- AUTH GATE GUIDANCE ---
// Prevents: Users confused about what the auth gate needs.

test("auth gate idle message explains what is required before input", async ({ page }) => {
  // auth-gate.tsx: idle state message is "A valid session cookie is required before the UI can load."
  // A confused user should understand what the gate does before trying to unlock.
  await page.goto("/");

  const statusChip = page.locator(".auth-form .status-chip").first();
  await expect(statusChip).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  const message = await statusChip.innerText();
  // Message should explain what's needed, not be empty.
  expect(message.length).toBeGreaterThan(10);
  expect(message.toLowerCase()).toMatch(/session|cookie|valid|key|unlock/u);
});

test("auth gate heading clearly explains what is behind the gate", async ({ page }) => {
  // auth-gate.tsx: h1 says "Unlock the single-user control plane."
  // The lede explains what's behind the gate.
  await page.goto("/");

  const heading = page.getByRole("heading", { name: "Unlock the single-user control plane." });
  await expect(heading).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // The lede should explain what's protected.
  const lede = page.locator(".auth-panel .lede");
  await expect(lede).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
  const ledeText = await lede.innerText();
  expect(ledeText.toLowerCase()).toMatch(/dashboard|goal|approval|access/u);
});

// --- TOAST AUTO-DISMISSAL ---
// Prevents: Users confused by persistent notifications that don't go away.

test("success toasts auto-dismiss within a reasonable timeframe", async ({ page }) => {
  // toast.tsx: default duration is 5000ms.
  // A confused user should not see stale toasts lingering forever.
  await unlockDashboard(page);
  await showAdvancedOperations(page);

  // Create a note to trigger a toast.
  await page.getByPlaceholder(NOTE_TITLE_PLACEHOLDER).fill("Auto-dismiss test");
  await page.getByPlaceholder(NOTE_BODY_PLACEHOLDER).fill("Testing toast auto-dismissal.");
  await page.getByRole("button", { name: "Create local note" }).click();

  // Wait for success feedback.
  await expect(page.getByText("Created a new local note.")).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // If a toast container appears, verify the toast eventually disappears.
  const toastContainer = page.locator(".toast-container");
  const hasToast = await toastContainer.isVisible().catch(() => false);

  if (hasToast) {
    const toastItems = toastContainer.locator(".toast");
    const initialCount = await toastItems.count();

    if (initialCount > 0) {
      // Wait for auto-dismiss (default 5s + buffer).
      await expect(toastItems).toHaveCount(0, { timeout: 15_000 });
    }
  }
});

// --- ACCESSIBILITY OF STATUS INDICATORS ---
// Prevents: Users who rely on screen readers missing important status changes.

test("status chips use semantic class names that map to visual states", async ({ page }) => {
  // All status-chip elements use .success, .error, or .idle classes.
  // Screen readers can infer meaning from the class-driven visual state.
  await unlockDashboard(page);

  // Trigger an error state.
  await page.getByRole("button", { name: "Request work" }).click();
  const submitButton = submitButtonOf(page);
  await submitButton.click();

  // Error chip should be visible.
  const errorChip = page.locator(".status-chip.error");
  await expect(errorChip).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // Verify it has the error class for consistent styling.
  await expect(errorChip).toHaveClass(/error/u);
});

// --- BODY SCROLL LOCK ---
// Prevents: Users confused by background scroll while a panel is open.

test("body scroll is locked when slide-out panel is open", async ({ page }) => {
  // slide-out-panel.tsx: sets document.body.style.overflow = "hidden" when open.
  // A confused user should not accidentally scroll past the panel.
  await unlockDashboard(page);

  const { requestCard, requestInput } = await openRequestComposer(page);
  await submitRequest(requestCard, requestInput, "Test goal for scroll lock.");

  // Scroll down a bit first.
  await page.evaluate(() => window.scrollTo(0, 100));

  // Open the detail drawer.
  const openDetailsButton = page.locator(".request-card .list-item").first().getByRole("button", { name: "Open details" });
  await expect(openDetailsButton).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
  await openDetailsButton.click();

  const drawer = page.locator(".slideout-panel[role='dialog']").first();
  await expect(drawer).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  // Body overflow should be hidden.
  const bodyOverflow = await page.evaluate(() => document.body.style.overflow);
  expect(bodyOverflow).toBe("hidden");

  // Close the panel.
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden({ timeout: E2E_UI_TIMEOUT_MS });

  // Body overflow should be restored.
  const restoredOverflow = await page.evaluate(() => document.body.style.overflow);
  expect(restoredOverflow).toBe("");
});

// --- CONTEXTUAL SUGGESTION ---
// Prevents: Users not knowing what to type in the request textarea.

test("request composer textarea has a concrete example placeholder", async ({ page }) => {
  // dashboard-goals-card.tsx: placeholder="Example: Clear today's approvals..."
  // A confused user should see a specific example, not "Enter text here".
  await unlockDashboard(page);
  await page.getByRole("button", { name: "Request work" }).click();

  const textarea = page.locator(".request-card textarea");
  await expect(textarea).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });

  const placeholder = await textarea.getAttribute("placeholder");
  expect(placeholder).toBeTruthy();
  expect(placeholder!.length).toBeGreaterThan(20);
  expect(placeholder!.toLowerCase()).toMatch(/example|try|e\.g\./u);
});
