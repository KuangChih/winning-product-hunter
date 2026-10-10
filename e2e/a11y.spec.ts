import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = ["/", "/products", "/ads", "/watchlist", "/sources", "/login"];

/** WCAG 2.1 A/AA rules checked by axe-core on every page, in both color schemes. */
for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`accessibility (${colorScheme})`, () => {
    test.use({ colorScheme });

    for (const path of PAGES) {
      test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await page.waitForLoadState("networkidle");
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          // The Next.js dev tools badge is not part of the site.
          .exclude("nextjs-portal")
          .analyze();
        const summary = results.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
        }));
        expect(summary).toEqual([]);
      });
    }

    test(`a product page has no WCAG A/AA violations`, async ({ page }) => {
      await page.goto("/products");
      const table = page.getByRole("table");
      await expect(
        table.or(page.getByText(/No database configured|No real products yet|not set up/)),
      ).toBeVisible();
      test.skip(!(await table.isVisible()), "No products in this environment");
      await table.getByRole("link").first().click();
      await expect(page.getByRole("heading", { name: "Why this score" })).toBeVisible();
      await page.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .exclude("nextjs-portal")
        .analyze();
      expect(
        results.violations.map((v) => ({
          id: v.id,
          targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
        })),
      ).toEqual([]);
    });
  });
}

test("keyboard users can skip straight to the content", async ({ page }) => {
  await page.goto("/products");
  // Wait for the streamed content, so there is something focusable inside main.
  await expect(page.getByRole("searchbox")).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  // The next Tab lands inside the main content, not back in the header.
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("#main"))).toBe(true);
});
