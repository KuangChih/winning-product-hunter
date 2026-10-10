import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 375, height: 812 } });

// Wide tables scroll inside their own container; the page itself must never scroll sideways.
for (const path of ["/", "/products", "/ads", "/watchlist", "/discover"]) {
  test(`${path} fits a phone screen`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Let streamed content arrive before measuring.
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);

    // The bottom tab bar: four links, all on screen, and the page leaves room for it.
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link")).toHaveCount(4);
    for (const link of await nav.getByRole("link").all()) await expect(link).toBeInViewport();
    const navBox = (await nav.boundingBox())!;
    expect(navBox.y + navBox.height).toBeCloseTo(812, 0);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const footer = (await page.locator("footer").boundingBox())!;
    expect(footer.y + footer.height).toBeLessThanOrEqual(navBox.y + 1);
  });
}

test("the ranking shows cards instead of the table on a phone", async ({ page }) => {
  await page.goto("/products");
  const cards = page.getByRole("article");
  await expect(
    cards.first().or(page.getByText(/No database configured|No products yet|not set up/)),
  ).toBeVisible();
  test.skip(!(await cards.first().isVisible()), "No products in this environment");
  await expect(page.getByRole("table")).toBeHidden();
  const card = cards.first();
  await expect(card.getByRole("button", { name: /^Watch / })).toBeVisible();
  // The seven sub-scores: a value or a dash each.
  const values = await card.getByRole("definition").allTextContents();
  expect(values).toHaveLength(7);
  for (const v of values) expect(v).toMatch(/^(\d{1,3}|—)$/);
});

test("a product page fits a phone screen", async ({ page }) => {
  await page.goto("/products");
  const cards = page.getByRole("article");
  await expect(
    cards.first().or(page.getByText(/No database configured|No products yet|not set up/)),
  ).toBeVisible();
  test.skip(!(await cards.first().isVisible()), "No products in this environment");
  await cards.first().getByRole("link").first().click();
  await expect(page.getByRole("heading", { name: "Why this score" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});
