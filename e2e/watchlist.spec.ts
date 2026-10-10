import { expect, test } from "@playwright/test";

test("a product can be watched from its page and unwatched from the watchlist", async ({
  page,
}) => {
  await page.goto("/products");
  const table = page.getByRole("table");
  await expect(
    table.or(page.getByText(/No database configured|No real products yet|not set up/)),
  ).toBeVisible();
  test.skip(!(await table.isVisible()), "No scored products in this environment");

  const link = table.locator("tbody").getByRole("link").first();
  const name = (await link.textContent())!.trim();
  await link.click();

  // Start from a known state even if an earlier run left it watched.
  const watching = page.getByRole("button", { name: "★ Watching" });
  const watch = page.getByRole("button", { name: "☆ Watch" });
  await expect(watch.or(watching)).toBeVisible();
  if (await watching.isVisible()) {
    await watching.click();
    await expect(watch).toBeVisible();
  }
  await watch.click();
  await expect(watching).toBeVisible();

  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Watchlist" })
    .click();
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "★ Watching" }).click();
  await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);
});
