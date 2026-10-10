"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  clearLoginFailures,
  clientAddress,
  clientHash,
  isLoginThrottled,
  recordLoginFailure,
} from "@/data/login-throttle";
import { type AnyDatabase, getDb, isDatabaseConfigured, isMissingTableError } from "@/db/client";
import {
  safeEqual,
  safeNextPath,
  SITE_AUTH_COOKIE,
  SITE_AUTH_MAX_AGE,
  sitePassword,
  siteToken,
} from "@/lib/site-auth";

/**
 * Throttling needs the database. Without one (local development) logins are not throttled; a
 * missing table means migrations have not run yet, which should not lock the owner out.
 */
async function withThrottleDb<T>(fn: (db: AnyDatabase) => Promise<T>, fallback: T): Promise<T> {
  if (!isDatabaseConfigured()) return fallback;
  try {
    return await fn(await getDb());
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    console.warn("login throttling disabled: run database migrations");
    return fallback;
  }
}

export async function login(formData: FormData) {
  const next = safeNextPath(String(formData.get("next") ?? "/"));
  const password = sitePassword();
  if (!password) redirect(next);

  const client = await clientHash(clientAddress(await headers()), await siteToken(password));
  const retry = `next=${encodeURIComponent(next)}`;
  if (await withThrottleDb((db) => isLoginThrottled(db, client), false)) {
    redirect(`/login?error=locked&${retry}`);
  }

  const attempt = String(formData.get("password") ?? "");
  // Compare hashes so the comparison time does not depend on the password length.
  if (!safeEqual(await siteToken(attempt), await siteToken(password))) {
    await withThrottleDb((db) => recordLoginFailure(db, client), undefined);
    redirect(`/login?error=1&${retry}`);
  }

  await withThrottleDb((db) => clearLoginFailures(db, client), undefined);
  (await cookies()).set(SITE_AUTH_COOKIE, await siteToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SITE_AUTH_MAX_AGE,
  });
  redirect(next);
}
