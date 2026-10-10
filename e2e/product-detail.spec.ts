import { expect, test } from "@playwright/test";

test("a ranked product opens its detail page with score breakdown and evidence", async ({
  page,
}) => {
  await page.goto("/products");
  const table = page.getByRole("table");
  await expect(
    table.or(page.getByText(/No database configured|No scored products yet|not set up/)),
  ).toBeVisible();
  test.skip(!(await table.isVisible()), "No scored products in this environment");

  const link = table.locator("tbody").getByRole("link").first();
  const name = (await link.textContent())!.trim();
  await link.click();
  await expect(page.getByRole("heading", { name: "Why this score" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Margin estimate" })).toBeVisible();
  await expect(page).toHaveTitle(`${name} · Winning Product Hunter`);
  await expect(page.getByRole("heading", { name: "Evidence" })).toBeVisible();
  await expect(page.getByRole("link", { name: "← All winning products" })).toBeVisible();
});

test("an unknown product shows the not-found page", async ({ page }) => {
  // The page streams, so the status is already 200 when notFound() runs; check the UI instead.
  await page.goto("/products/this-product-does-not-exist");
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});
