import { expect, test } from "@playwright/test";

test.describe("dark mode", () => {
  test.use({ colorScheme: "dark" });

  test("follows the system setting by default", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  });

  test("a chosen theme survives reloads and applies before paint", async ({ page }) => {
    await page.goto("/");
    // system (dark) → light
    await page.getByRole("button", { name: /^System theme/ }).click();
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);

    // The init script reads the choice before React loads, so even the raw HTML is light.
    await page.reload();
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
    await expect(page.getByRole("button", { name: /^Light theme/ })).toBeVisible();
  });
});
