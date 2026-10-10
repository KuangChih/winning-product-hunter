import { expect, test } from "@playwright/test";

test("the ad browser opens from the navigation and filters by URL", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Ads" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ads" })).toBeVisible();
  // Depending on the environment this shows ads or a setup notice, never an error.
  await expect(
    page
      .getByText(/^\d[\d,]* ads/)
      .or(page.getByText(/No database configured|No ads collected yet|not set up/)),
  ).toBeVisible();

  await page.goto("/ads?market=US&status=active&sort=newest");
  // Applied filters show as chips; the folded panel opens to edit them.
  await expect(
    page.getByRole("link", { name: "Remove filter: Market: United States" }),
  ).toBeVisible();
  await page.getByText("Filters (2)").click();
  await expect(page.getByRole("combobox", { name: "Market" })).toHaveValue("US");
  await expect(page.getByRole("combobox", { name: "Status" })).toHaveValue("active");
  await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveValue("newest");
});
