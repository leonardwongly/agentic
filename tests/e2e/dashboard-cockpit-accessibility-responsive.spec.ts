import { expect, test, type Page } from "@playwright/test";
import { E2E_UI_TIMEOUT_MS, unlockDashboard } from "./helpers";

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 390, height: 844 }
];

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth
  }));

  expect(overflow.html).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
}

async function expectFocusedElementVisible(page: Page) {
  const focus = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    const style = element ? getComputedStyle(element) : null;

    return {
      tagName: element?.tagName ?? null,
      width: element?.getBoundingClientRect().width ?? 0,
      height: element?.getBoundingClientRect().height ?? 0,
      outlineStyle: style?.outlineStyle ?? "none",
      outlineWidth: style?.outlineWidth ?? "0px",
      boxShadow: style?.boxShadow ?? "none"
    };
  });

  expect(focus.tagName).not.toBeNull();
  expect(focus.width).toBeGreaterThan(0);
  expect(focus.height).toBeGreaterThan(0);
  expect(focus.outlineStyle !== "none" || focus.boxShadow !== "none" || focus.outlineWidth !== "0px").toBe(true);
}

async function seedGoalThroughApi(page: Page, request: string) {
  const createResponse = await page.request.post("/api/goals", {
    data: { request }
  });
  expect(createResponse.status()).toBe(202);

  const createPayload = (await createResponse.json()) as { statusUrl: string };
  await expect
    .poll(
      async () => {
        const statusResponse = await page.request.get(createPayload.statusUrl);
        const statusPayload = (await statusResponse.json()) as { job: { status: string } };
        return statusPayload.job.status;
      },
      { timeout: E2E_UI_TIMEOUT_MS * 3 }
    )
    .toBe("completed");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Traceability" })).toBeVisible({
    timeout: E2E_UI_TIMEOUT_MS
  });
}

for (const viewport of viewports) {
  test(`cockpit layout is accessible and responsive at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await unlockDashboard(page);

    await expect(page.getByRole("heading", { name: "Command center" })).toBeVisible();
    await expect(page.getByLabel("Operator priority queue")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Traceability" })).toBeVisible();
    await expect(page.locator("[data-ui-status-pill]").first()).toContainText(/\S/u);
    if ((await page.locator("[data-ui-risk-pill]").count()) > 0) {
      await expect(page.locator("[data-ui-risk-pill]").first()).toContainText(/\S/u);
    }
    await expectNoHorizontalOverflow(page);

    await page.keyboard.press("Tab");
    await expectFocusedElementVisible(page);
    await test.info().attach(`cockpit-${viewport.name}`, {
      body: await page.screenshot({ fullPage: true, animations: "disabled" }),
      contentType: "image/png"
    });
  });
}

test("cockpit keyboard journey covers command palette and detail drawer", async ({ page }) => {
  test.setTimeout(E2E_UI_TIMEOUT_MS * 5);

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await unlockDashboard(page);
  await seedGoalThroughApi(page, "Review my inbox and send one external reply.");

  await page.locator("body").click();
  await page.keyboard.down("Control");
  await page.keyboard.press("k");
  await page.keyboard.up("Control");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search commands" })).toBeFocused();
  await page.keyboard.type("approvals");
  const viewApprovalsCommand = palette.getByRole("button", { name: /View approvals/i });
  await expect(viewApprovalsCommand).toBeVisible();
  await expect(viewApprovalsCommand).toBeEnabled({
    timeout: E2E_UI_TIMEOUT_MS * 3
  });
  await viewApprovalsCommand.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/section=approvals/u);
  await expect(page.getByTestId("operator-priority-model")).toBeVisible();

  await page.getByRole("button", { name: "Open details" }).first().click();
  const drawer = page.locator(".slideout-panel[role='dialog']").first();
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(drawer.locator(":focus")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});
