import { expect, test } from "@playwright/test";
import { showAdvancedOperations, unlockDashboard } from "./helpers";

test("unlocks the dashboard and edits a local note end-to-end", async ({ page }) => {
  const uniqueSuffix = `${Date.now()}`;
  const title = `Playwright Notes ${uniqueSuffix}`;
  const initialBody = `seed body ${uniqueSuffix}`;
  const updatedBody = `updated body ${uniqueSuffix}`;

  await unlockDashboard(page);
  await showAdvancedOperations(page);

  await page.getByPlaceholder("Example: Travel packing list").fill(title);
  await page.getByPlaceholder("Write a note that should be searchable through the notes adapter.").fill(initialBody);
  await page.getByRole("button", { name: "Create local note" }).click();

  await expect(page.getByText("Created a new local note.")).toBeVisible();
  await expect(page.getByRole("heading", { name: `Edit ${title}` })).toBeVisible();

  const notesSection = page.locator("#section-notes");
  await notesSection.getByPlaceholder("Search local notes").fill(title);
  await notesSection.getByRole("button", { name: "Search", exact: true }).click();
  await expect(notesSection.getByText(/Loaded \d+ matching note/u)).toBeVisible();

  const searchedNote = notesSection.locator(".list-item.vertical").filter({ hasText: title }).first();
  await expect(searchedNote.getByText(title, { exact: true })).toBeVisible();
  await searchedNote.getByRole("button", { name: "Open" }).click();

  const editorTitle = page.getByPlaceholder("Open a note to edit its title");
  const editorBody = page.getByPlaceholder("Open a note to edit its body.");

  await expect(editorTitle).toHaveValue(title);
  await editorBody.click();
  await editorBody.press("ControlOrMeta+A");
  await editorBody.press("Backspace");
  await editorBody.pressSequentially(updatedBody);
  await expect(editorBody).toHaveValue(updatedBody);
  await page.getByRole("button", { name: "Save selected note" }).click();

  await expect(page.getByText(`Saved note "${title}".`)).toBeVisible();

  await notesSection.getByPlaceholder("Search local notes").fill(title);
  await notesSection.getByRole("button", { name: "Search", exact: true }).click();
  await expect(notesSection.getByText(/Loaded \d+ matching note/u)).toBeVisible();

  const updatedSearchResult = notesSection.locator(".list-item.vertical").filter({ hasText: title }).first();
  await expect(updatedSearchResult.getByText(title, { exact: true })).toBeVisible();
  await expect(updatedSearchResult).toContainText(updatedBody);
  await expect(editorBody).toHaveValue(updatedBody);
});
