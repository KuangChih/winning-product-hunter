import { expect, test } from "@playwright/test";

test("a ranked product opens its detail page with score breakdown and evidence", async ({
  page,
}) => {
  await page.goto("/products");
  const table = page.getByRole("table");
  await expect(
    table.or(page.getByText(/No database configured|No products yet|not set up/)),
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

test("evidence sections fold, with the first ads shown and the rest behind a toggle", async ({
  page,
}) => {
  await page.goto("/products");
  const table = page.getByRole("table");
  await expect(
    table.or(page.getByText(/No database configured|No products yet|not set up/)),
  ).toBeVisible();
  test.skip(!(await table.isVisible()), "No scored products in this environment");
  await table.locator("tbody").getByRole("link").first().click();

  const ads = page.locator("details", {
    has: page.getByRole("heading", { name: /^Ads \(\d+\)$/ }),
  });
  await expect(ads).toHaveAttribute("open", "");
  const showAll = page.getByText(/^Show all \d+ ads$/);
  test.skip(!(await showAll.isVisible()), "This product has 5 ads or fewer");
  await expect(ads.getByRole("link", { name: /^View ad/ })).toHaveCount(5);
  await showAll.click();
  await expect(page.getByText("Show fewer")).toBeVisible();
  expect(await ads.getByRole("link", { name: /^View ad/ }).count()).toBeGreaterThan(5);
});
