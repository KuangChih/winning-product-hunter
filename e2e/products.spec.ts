import { expect, test } from "@playwright/test";

test("products page renders without crashing and links from home", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "See winning products" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Winning products" })).toBeVisible();
  // Depending on the environment this shows the ranking or a setup notice, never an error.
  await expect(
    page.getByRole("table").or(page.getByText(/No database configured|No products yet|not set up/)),
  ).toBeVisible();
});

test("price range and evidence filters come from the URL and narrow the list", async ({ page }) => {
  await page.goto("/products?minPrice=10&maxPrice=1000&source=shopify");
  // Applied filters show as chips; the folded panel opens to edit them.
  await expect(
    page.getByRole("link", { name: "Remove filter: Evidence: Shopify stores" }),
  ).toBeVisible();
  await page.getByText("Filters (3)").click();
  await expect(page.getByRole("spinbutton", { name: "Min. price (US$)" })).toHaveValue("10");
  await expect(page.getByRole("spinbutton", { name: "Max. price (US$)" })).toHaveValue("1000");
  await expect(page.getByRole("combobox", { name: "Evidence" })).toHaveValue("shopify");
  const table = page.getByRole("table");
  await expect(
    table.or(page.getByText(/No products match these filters|No database configured|not set up/)),
  ).toBeVisible();
  if (await table.isVisible()) {
    // Every listed product has a known US price inside the range.
    const prices = await table.locator("tbody tr td:nth-child(11)").allTextContents();
    for (const p of prices) {
      const value = Number(p.replace(/[$,]/g, ""));
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThanOrEqual(1000);
    }
  }
});

test("ranks by a single signal and filters on it, showing only real values", async ({ page }) => {
  await page.goto("/products?sort=longevity&min_longevity=data");
  await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveValue("longevity");
  const table = page.getByRole("table");
  await expect(
    table.or(page.getByText(/No products match these filters|No database configured|not set up/)),
  ).toBeVisible();
  test.skip(!(await table.isVisible()), "No products in this environment");

  await expect(table.getByRole("columnheader", { name: /Longevity/ })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  // Column 4 is Longevity: every row has real data, highest first.
  const values = (await table.locator("tbody tr td:nth-child(4)").allTextContents()).map(Number);
  expect(values.every((v) => Number.isFinite(v) && v >= 0 && v <= 100)).toBe(true);
  expect(values).toEqual([...values].sort((a, b) => b - a));
});
