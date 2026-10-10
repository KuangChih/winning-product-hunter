import { expect, test } from "@playwright/test";

test("pages send security headers and ask not to be indexed", async ({ request }) => {
  const res = await request.get("/products");
  expect(res.ok()).toBe(true);
  const headers = res.headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-robots-tag"]).toContain("noindex");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("robots.txt disallows everything", async ({ request }) => {
  const res = await request.get("/robots.txt");
  expect(res.ok()).toBe(true);
  expect(await res.text()).toMatch(/User-Agent: \*\s+Disallow: \/\s*$/);
});

test("pages carry a noindex robots meta tag", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});
