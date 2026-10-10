import { expect, test } from "@playwright/test";

test("the discovery page opens from the navigation and states what it can do", async ({ page }) => {
  await page.goto("/products");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Discover" })
    .click();
  await expect(page).toHaveURL(/\/discover$/);
  await expect(page.getByRole("heading", { level: 1, name: "Discover" })).toBeVisible();
  await expect(page).toHaveTitle("Discover · Winning Product Hunter");

  // e2e turns discovery off (PIPELINE_DISABLED=1): no button that would send real requests.
  await expect(page.getByText("Discovery is turned off on this deployment.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start discovery" })).toHaveCount(0);

  await expect(page.getByRole("heading", { name: "Recent runs" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Data sources" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
  // Owner-facing text only: no commands or local config files.
  await expect(page.getByText(/npm run|\.env\.local/)).toHaveCount(0);
});

test("the old data-sources page moved to the discovery page for good", async ({ page }) => {
  const res = await page.request.get("/sources", { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(res.headers().location).toBe("/discover");
  await page.goto("/zh-TW/sources");
  await expect(page).toHaveURL(/\/zh-TW\/discover$/);
  await expect(page.getByRole("heading", { level: 1, name: "探索" })).toBeVisible();
});
