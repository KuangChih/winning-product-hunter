"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  safeEqual,
  safeNextPath,
  SITE_AUTH_COOKIE,
  SITE_AUTH_MAX_AGE,
  sitePassword,
  siteToken,
} from "@/lib/site-auth";

export async function login(formData: FormData) {
  const next = safeNextPath(String(formData.get("next") ?? "/"));
  const password = sitePassword();
  if (!password) redirect(next);

  const attempt = String(formData.get("password") ?? "");
  // Compare hashes so the comparison time does not depend on the password length.
  if (!safeEqual(await siteToken(attempt), await siteToken(password))) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }

  (await cookies()).set(SITE_AUTH_COOKIE, await siteToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SITE_AUTH_MAX_AGE,
  });
  redirect(next);
}
