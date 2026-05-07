import { expect, test } from "@playwright/test";
import { openRequestComposer, submitRequest, unlockDashboard } from "./helpers";

test("operating loop cards deep-link operators into the active queue", async ({ page }) => {
  await unlockDashboard(page);

  const { requestCard, requestInput } = await openRequestComposer(page);
  await submitRequest(
    requestCard,
    requestInput,
    "Review my inbox and send one external reply."
  );

  const operatingLoop = page.locator(".control-plane-card");
  const nowCard = operatingLoop.locator('.control-plane-section:has(strong:text-is("Now"))');
  const executionCard = operatingLoop.locator('.control-plane-section:has(strong:text-is("Execution"))');
  const ownerLaneControl = operatingLoop.locator('.control-plane-detail-card:has(strong:text-is("Open owner lane"))');

  await expect(operatingLoop.getByRole("heading", { name: "Operating loop" })).toBeVisible();
  await expect(nowCard).toBeVisible();
  await expect(executionCard).toBeVisible();
  await expect(ownerLaneControl).toBeVisible();

  await ownerLaneControl.click();
  await expect(page).toHaveURL(/section=approvals/);
  await expect(page).toHaveURL(/item=/);
  await expect(page.locator("#section-approvals .selection-highlight").first()).toBeVisible();

  await nowCard.click();
  await expect(page).toHaveURL(/section=now/);
  await expect(page.locator("#section-now .selection-highlight").first()).toBeVisible();

  await executionCard.click();
  await expect(page).toHaveURL(/section=approvals/);
  await expect(page).toHaveURL(/item=/);
  await expect(page.locator("#section-approvals .selection-highlight").first()).toBeVisible();
});
