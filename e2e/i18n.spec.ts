import { expect, test } from "@playwright/test";

test("the language switcher changes the UI language and keeps the URL", async ({ page }) => {
  await page.goto("/products?market=US");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const nav = () => page.getByRole("navigation").first();

  await page.getByRole("button", { name: /繁體中文/ }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
  await expect(nav().getByRole("link", { name: "熱賣產品" })).toBeVisible();
  // Same URL: the language comes from a cookie, not the path.
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe("/products?market=US");

  // The choice survives navigation.
  await nav().getByRole("link", { name: "廣告" }).click();
  await expect(page).toHaveURL(/\/ads$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");

  await page.getByRole("button", { name: /English/ }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(nav().getByRole("link", { name: "Ads" })).toBeVisible();
});

test("a language-prefixed URL works without the cookie", async ({ page }) => {
  await page.goto("/zh-TW/sources");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
  await expect(page.getByRole("link", { name: "資料來源" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("the home page is translated", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "locale", value: "zh-TW", url: baseURL! }]);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "查看熱賣產品" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "目前排名前三的產品" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "運作方式" })).toBeVisible();
});

test("the ranking page is translated", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "locale", value: "zh-TW", url: baseURL! }]);
  await page.goto("/products");
  await expect(page).toHaveTitle("熱賣產品 · Winning Product Hunter");
  await expect(page.getByRole("heading", { level: 1, name: "熱賣產品" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "排序" })).toBeVisible();
  const table = page.getByRole("table");
  await expect(
    table.or(page.getByText(/尚未設定資料庫|還沒有真實產品|還沒有已評分的產品/)),
  ).toBeVisible();
  if (await table.isVisible()) {
    await expect(table.getByRole("columnheader", { name: "可信度" })).toBeVisible();
  }
});

test("the product detail page is translated", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "locale", value: "zh-TW", url: baseURL! }]);
  await page.goto("/products");
  const table = page.getByRole("table");
  await expect(
    table.or(page.getByText(/尚未設定資料庫|還沒有真實產品|還沒有已評分的產品/)),
  ).toBeVisible();
  test.skip(!(await table.isVisible()), "No products in this environment");
  await table.locator("tbody").getByRole("link").first().click();
  await expect(page.getByRole("heading", { name: "分數怎麼來的" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "毛利估算" })).toBeVisible();
  await expect(page.getByRole("link", { name: "← 所有熱賣產品" })).toBeVisible();
  await expect(page.getByRole("button", { name: /收藏/ })).toBeVisible();
});

test("the evidence list is translated", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "locale", value: "zh-TW", url: baseURL! }]);
  await page.goto("/products");
  const table = page.getByRole("table");
  await expect(
    table.or(page.getByText(/尚未設定資料庫|還沒有真實產品|還沒有已評分的產品/)),
  ).toBeVisible();
  test.skip(!(await table.isVisible()), "No products in this environment");
  await table.locator("tbody").getByRole("link").first().click();
  await expect(page.getByRole("heading", { name: "證據" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /^(廣告|販售的店家|搜尋需求|供應商報價)/ }).first(),
  ).toBeVisible();
  await expect(page.getByText("No evidence collected yet.")).toHaveCount(0);
});

test("the ads and watchlist pages are translated", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "locale", value: "zh-TW", url: baseURL! }]);
  await page.goto("/ads");
  await expect(page).toHaveTitle("廣告 · Winning Product Hunter");
  await expect(page.getByRole("search", { name: "篩選廣告" })).toBeVisible();
  await page.goto("/watchlist");
  await expect(page).toHaveTitle("收藏 · Winning Product Hunter");
  await expect(page.getByRole("heading", { level: 1, name: "收藏" })).toBeVisible();
  await expect(
    page.getByRole("table").or(page.getByText(/還沒有收藏任何產品|尚未設定資料庫|資料庫尚未建立/)),
  ).toBeVisible();
});

test("the data sources and login pages are translated", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "locale", value: "zh-TW", url: baseURL! }]);
  await page.goto("/sources");
  await expect(page).toHaveTitle("資料來源 · Winning Product Hunter");
  await expect(page.getByRole("heading", { level: 1, name: "資料來源" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^目前：跟隨系統主題/ })).toBeVisible();
  await page.goto("/login");
  await expect(page).toHaveTitle("登入 · Winning Product Hunter");
  await expect(page.getByLabel("密碼")).toBeVisible();
  await expect(page.getByRole("button", { name: "登入" })).toBeVisible();
});
