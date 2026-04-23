import { expect, test } from "@playwright/test";
import { openRequestComposer, unlockDashboard } from "./helpers";

test("operating loop cards deep-link operators into the active queue", async ({ page }) => {
  await unlockDashboard(page);

  const { requestCard, requestInput, submitButton } = await openRequestComposer(page);
  await requestInput.fill(
    "Review my inbox and send one external reply."
  );
  await expect(submitButton).toBeEnabled({ timeout: 15_000 });
  await submitButton.click();

  await expect(requestCard.locator(".status-chip.success").getByText("Created a new goal bundle.")).toBeVisible({
    timeout: 15_000
  });

  const operatingLoop = page.locator(".control-plane-card");
  const nowCard = operatingLoop.locator('.control-plane-section:has(strong:text-is("Now"))');
  const executionCard = operatingLoop.locator('.control-plane-section:has(strong:text-is("Execution"))');

  await expect(operatingLoop.getByRole("heading", { name: "Operating loop" })).toBeVisible();
  await expect(nowCard).toBeVisible();
  await expect(executionCard).toBeVisible();

  await nowCard.click();
  await expect(page).toHaveURL(/section=now/);
  await expect(page.locator("#section-now .selection-highlight").first()).toBeVisible();

  await executionCard.click();
  await expect(page).toHaveURL(/section=(approvals|operations)/);
  await expect(page).toHaveURL(/item=/);
  await expect(page.locator("#section-approvals .selection-highlight, #section-operations .selection-highlight").first()).toBeVisible();
});
