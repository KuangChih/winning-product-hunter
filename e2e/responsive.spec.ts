import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 375, height: 812 } });

// Wide tables scroll inside their own container; the page itself must never scroll sideways.
for (const path of ["/", "/products", "/ads", "/watchlist", "/sources"]) {
  test(`${path} fits a phone screen`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Let streamed content arrive before measuring.
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);

    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link")).toHaveCount(4);
    for (const link of await nav.getByRole("link").all()) await expect(link).toBeInViewport();
  });
}
