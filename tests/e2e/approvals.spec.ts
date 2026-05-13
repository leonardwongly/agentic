import { expect, test } from "@playwright/test";
import { E2E_UI_TIMEOUT_MS, openRequestComposer, submitRequest, unlockDashboard } from "./helpers";

test.setTimeout(process.env.CI ? 90_000 : 30_000);

test("creates and approves an inbox-triage goal end-to-end", async ({ page }) => {
  await unlockDashboard(page);

  const { requestCard, requestInput } = await openRequestComposer(page);
  await submitRequest(
    page,
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

  await expect(approvalRows).toHaveCount(initialApprovalCount - 1, {
    timeout: E2E_UI_TIMEOUT_MS
  });
  await expect(page.getByText("Marked the approval as approved.").first()).toBeVisible({
    timeout: E2E_UI_TIMEOUT_MS
  });

  const approvalTimelineRow = page
    .locator(".timeline-row")
    .filter({
      hasText: 'Approved "Prepare sender-aware drafts requires approval".'
    })
    .first();

  await expect(approvalTimelineRow.getByText("approval.responded")).toBeVisible({
    timeout: E2E_UI_TIMEOUT_MS
  });
  await expect(approvalTimelineRow).toContainText('Approved "Prepare sender-aware drafts requires approval".');
});
