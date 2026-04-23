import { expect, test } from "@playwright/test";
import { openRequestComposer, submitRequest, unlockDashboard } from "./helpers";

test("creates and approves an inbox-triage goal end-to-end", async ({ page }) => {
  await unlockDashboard(page);

  const { requestCard, requestInput } = await openRequestComposer(page);
  await submitRequest(
    requestCard,
    requestInput,
    "Triage my inbox and prepare replies for important clients."
  );
  await expect(
    page
      .locator(".request-card .list-item")
      .filter({
        hasText: "Inbox triage and follow-up prep"
      })
      .first()
  ).toBeVisible();

  const approvalRows = page.locator("#section-approvals .list-item.vertical").filter({
    hasText: "Prepare sender-aware drafts requires approval"
  });
  const initialApprovalCount = await approvalRows.count();
  const approvalRow = approvalRows.first();

  expect(initialApprovalCount).toBeGreaterThan(0);
  await expect(approvalRow).toBeVisible();
  await approvalRow.getByRole("button", { name: "Approve once" }).click();

  await expect(page.getByText("Marked the approval as approved.").first()).toBeVisible();
  await expect(approvalRows).toHaveCount(initialApprovalCount - 1);

  const approvalTimelineRow = page
    .locator(".timeline-row")
    .filter({
      hasText: 'Approved "Prepare sender-aware drafts requires approval".'
    })
    .first();

  await expect(approvalTimelineRow.getByText("approval.responded")).toBeVisible();
  await expect(approvalTimelineRow).toContainText('Approved "Prepare sender-aware drafts requires approval".');
});
