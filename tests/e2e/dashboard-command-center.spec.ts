import { expect, test } from "@playwright/test";
import { openRequestComposer, unlockDashboard } from "./helpers";

test("command center deep-links operators from exceptions into remediation views", async ({ page }) => {
  await unlockDashboard(page);

  const { requestCard, requestInput, submitButton } = await openRequestComposer(page);
  await requestInput.fill("Review my inbox and send one external reply.");
  await expect(submitButton).toBeEnabled({ timeout: 15_000 });
  await submitButton.click();

  await expect(requestCard.locator(".status-chip.success").getByText("Created a new goal bundle.")).toBeVisible({
    timeout: 15_000
  });

  const commandCenter = page.locator("#section-command-center");
  await expect(commandCenter.getByRole("heading", { name: "Command center" })).toBeVisible();
  await expect(commandCenter.getByText("Immediate exceptions")).toBeVisible();

  await commandCenter.locator(".command-center-metric.action").click();
  await expect(page).toHaveURL(/section=(approvals|operations)/);
  await expect(page).toHaveURL(/item=/);
  await expect(page.locator("#section-approvals .selection-highlight, #section-operations .selection-highlight").first()).toBeVisible();

  await commandCenter.getByRole("tab", { name: "Communications" }).click();
  await expect(commandCenter.getByRole("tab", { name: "Communications", selected: true })).toBeVisible();
  await expect(commandCenter.getByText("Approvals inbox")).toBeVisible();

  await commandCenter.getByRole("button", { name: /Approvals inbox/i }).click();
  await expect(page).toHaveURL(/section=approvals/);
  await expect(page.locator("#section-approvals .selection-highlight").first()).toBeVisible();
});

test("command center stays keyboard-operable and responsive on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await unlockDashboard(page);

  const { requestCard, requestInput, submitButton } = await openRequestComposer(page);
  await requestInput.fill("Clear approvals, unblock the automation queue, and confirm urgent follow-ups.");
  await expect(submitButton).toBeEnabled({ timeout: 15_000 });
  await submitButton.click();

  await expect(requestCard.locator(".status-chip.success").getByText("Created a new goal bundle.")).toBeVisible({
    timeout: 15_000
  });

  const commandCenter = page.locator("#section-command-center");
  const toplineMetrics = commandCenter.locator(".command-center-topline > *");

  await expect(commandCenter.getByRole("heading", { name: "Command center" })).toBeVisible();
  await expect(toplineMetrics).toHaveCount(4);

  const firstMetricBox = await toplineMetrics.nth(0).boundingBox();
  const secondMetricBox = await toplineMetrics.nth(1).boundingBox();

  expect(firstMetricBox).not.toBeNull();
  expect(secondMetricBox).not.toBeNull();
  expect(Math.abs((firstMetricBox?.x ?? 0) - (secondMetricBox?.x ?? 0))).toBeLessThan(2);
  expect(secondMetricBox?.y ?? 0).toBeGreaterThan(firstMetricBox?.y ?? 0);

  const executiveTab = commandCenter.getByRole("tab", { name: "Executive" });
  await executiveTab.focus();
  await page.keyboard.press("Enter");
  await expect(commandCenter.getByRole("tab", { name: "Executive", selected: true })).toBeVisible();
  await expect(commandCenter.getByRole("tabpanel")).toContainText("Executive");

  const nextBestAction = commandCenter.locator(".command-center-metric.action");
  await nextBestAction.focus();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/section=(approvals|operations)/);
  await expect(page.locator("#section-approvals .selection-highlight, #section-operations .selection-highlight").first()).toBeVisible();
});
