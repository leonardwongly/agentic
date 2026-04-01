import { expect, test } from "@playwright/test";
import { unlockDashboard } from "./helpers";

test("creates and approves an inbox-triage goal end-to-end", async ({ page }) => {
  await unlockDashboard(page);

  await page.getByPlaceholder("Example: Triage my inbox and draft replies for anything urgent.").fill(
    "Triage my inbox and prepare replies for important clients."
  );
  await page.getByRole("button", { name: "Create goal" }).click();

  await expect(page.getByText("Created a new goal bundle.")).toBeVisible();
  await expect(
    page
      .locator(".request-card .list-item")
      .filter({
        hasText: "Inbox triage and follow-up prep"
      })
      .first()
  ).toBeVisible();

  const approvalRow = page.locator(".list-item.vertical").filter({
    hasText: "Prepare sender-aware drafts requires approval"
  });

  await expect(approvalRow).toBeVisible();
  await approvalRow.getByRole("button", { name: "Approve" }).click();

  await expect(page.getByText("Marked the approval as approved.")).toBeVisible();
  await expect(page.getByText("No pending approvals.")).toBeVisible();

  const approvalTimelineRow = page
    .locator(".timeline-row")
    .filter({
      hasText: 'Approved "Prepare sender-aware drafts requires approval".'
    })
    .first();

  await expect(approvalTimelineRow.getByText("approval.responded")).toBeVisible();
  await expect(approvalTimelineRow).toContainText('Approved "Prepare sender-aware drafts requires approval".');
});
