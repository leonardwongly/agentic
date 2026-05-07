import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_UI_TIMEOUT_MS, openRequestComposer, unlockDashboard } from "./helpers";

const COCKPIT_E2E_TIMEOUT_MS = Math.max(E2E_UI_TIMEOUT_MS, 15_000);

const cockpitViewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 }
] as const;

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
  }));

  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 2);
}

async function expectNoVisibleOverlap(page: Page, selector: string) {
  const boxes = await page.locator(selector).evaluateAll((elements) =>
    elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        };
      })
      .filter((rect) => rect.width > 0 && rect.height > 0)
  );

  for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex += 1) {
      const left = boxes[leftIndex]!;
      const right = boxes[rightIndex]!;
      const separated =
        left.right <= right.left + 1 ||
        right.right <= left.left + 1 ||
        left.bottom <= right.top + 1 ||
        right.bottom <= left.top + 1;

      expect(separated).toBe(true);
    }
  }
}

async function submitCockpitRequest(requestCard: Locator, requestInput: Locator, request: string) {
  await requestInput.fill(request);
  await expect(requestInput).toHaveValue(request, { timeout: COCKPIT_E2E_TIMEOUT_MS });
  await requestInput.press("Tab");

  const submitButton = requestCard.locator(".hero-button-row").getByRole("button", {
    name: "Submit request"
  });

  await expect(submitButton).toBeEnabled({ timeout: COCKPIT_E2E_TIMEOUT_MS });
  await submitButton.click();
  await expect(requestCard.locator(".status-chip.success").getByText("Created a new goal bundle.")).toBeVisible({
    timeout: COCKPIT_E2E_TIMEOUT_MS
  });
}

async function openCommandPalette(page: Page) {
  const input = page.getByPlaceholder("Type a command...");

  await page.locator("body").click({ position: { x: 10, y: 10 } });
  await page.keyboard.press("Control+K");

  if (!(await input.isVisible().catch(() => false))) {
    await page.keyboard.press("Meta+K");
  }

  await expect(input).toBeVisible({ timeout: E2E_UI_TIMEOUT_MS });
  return input;
}

for (const viewport of cockpitViewports) {
  test(`dashboard cockpit lanes avoid overflow and overlap on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await unlockDashboard(page);

    const { requestCard, requestInput } = await openRequestComposer(page);
    await submitCockpitRequest(
      requestCard,
      requestInput,
      `Prepare urgent approvals and recovery checks for ${viewport.name} cockpit validation.`
    );

    const cockpit = page.locator("#section-operate");
    await expect(cockpit.getByRole("heading", { name: "Operating cockpit" })).toBeVisible();

    for (const lane of ["Operate", "Approve", "Recover", "Govern", "Build", "Learn"]) {
      await expect(cockpit.locator(`.control-plane-detail-card:has(strong:text-is("${lane}"))`)).toBeVisible();
    }

    await expectNoHorizontalOverflow(page);
    await expectNoVisibleOverlap(page, "#section-operate .control-plane-detail-card");
  });
}

test("dashboard cockpit detail drawer and command palette preserve navigation", async ({ page }) => {
  await unlockDashboard(page);

  const { requestCard, requestInput } = await openRequestComposer(page);
  await submitCockpitRequest(requestCard, requestInput, "Review approvals and confirm command-palette navigation.");

  const cockpit = page.locator("#section-operate");
  await cockpit.locator('.control-plane-detail-card:has(strong:text-is("Approve"))').click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Open surface" }).click();
  await expect(page).toHaveURL(/section=approvals/);

  const paletteInput = await openCommandPalette(page);
  await paletteInput.fill("artifacts");
  await page.getByRole("button", { name: /View artifacts/u }).click();

  await expect(page).toHaveURL(/section=artifacts/);
  await expect(page.locator("#section-artifacts")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
