import { expect, test } from "@playwright/test";
import { openRequestComposer, unlockDashboard } from "./helpers";

test("creates and approves an inbox-triage goal end-to-end", async ({ page }) => {
  await unlockDashboard(page);

  const { requestCard, requestInput } = await openRequestComposer(page);
  await requestInput.fill(
    "Triage my inbox and prepare replies for important clients."
  );
  await requestCard.locator(".hero-button-row").getByRole("button", { name: "Submit request" }).click();

  await expect(requestCard.locator(".status-chip.success").getByText("Created a new goal bundle.")).toBeVisible();
  await expect(
    page
      .locator(".request-card .list-item")
      .filter({
        hasText: "Inbox triage and follow-up prep"
      })
      .first()
  ).toBeVisible();

  const approvalRow = page.locator("#section-approvals .list-item.vertical").filter({
    hasText: "Prepare sender-aware drafts requires approval"
  });

  await expect(approvalRow).toBeVisible();
  await approvalRow.getByRole("button", { name: "Approve once" }).click();

  await expect(page.getByText("Marked the approval as approved.").first()).toBeVisible();
  await expect(approvalRow).toHaveCount(0);

  const approvalTimelineRow = page
    .locator(".timeline-row")
    .filter({
      hasText: 'Approved "Prepare sender-aware drafts requires approval".'
    })
    .first();

  await expect(approvalTimelineRow.getByText("approval.responded")).toBeVisible();
  await expect(approvalTimelineRow).toContainText('Approved "Prepare sender-aware drafts requires approval".');
});
