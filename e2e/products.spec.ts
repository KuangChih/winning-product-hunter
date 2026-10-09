import { expect, test } from "@playwright/test";

test("products page renders without crashing and links from home", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "See winning products" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Winning products" })).toBeVisible();
  // Depending on the environment this shows the ranking or a setup notice, never an error.
  await expect(
    page.getByRole("table").or(page.getByText(/No database configured|No scored products yet/)),
  ).toBeVisible();
});
