import type { Metadata } from "next";
import { Suspense } from "react";
import { type Dictionary, getDictionary } from "@/i18n/dictionaries";
import { getLocale } from "@/i18n/server";
import { login } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = getDictionary(await getLocale());
  return { title: `${t.login.title} · ${t.site.name}`, robots: { index: false } };
}

async function LoginForm({
  searchParams,
  t,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  t: Dictionary["login"];
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";
  const failed = params.error === "1";
  const locked = params.error === "locked";
  const error = failed ? t.wrongPassword : locked ? t.locked : null;
  return (
    <form action={login} className="mt-6 space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1 text-sm">
        <span>{t.password}</span>
        <input
          type="password"
          name="password"
          required
          autoFocus
          autoComplete="current-password"
          aria-invalid={failed || undefined}
          aria-describedby={error ? "login-error" : undefined}
          className="border-input bg-background h-10 rounded-md border px-3"
        />
      </label>
      {error && (
        <p id="login-error" role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="bg-primary text-primary-foreground h-10 w-full rounded-md text-sm font-medium"
      >
        {t.submit}
      </button>
    </form>
  );
}

export default async function LoginPage({ searchParams }: PageProps<"/[lang]/login">) {
  const dict = getDictionary(await getLocale());
  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-20"
    >
      <h1 className="text-2xl font-semibold tracking-tight">{dict.site.name}</h1>
      <p className="text-muted-foreground mt-2 text-sm">{dict.login.intro}</p>
      <Suspense fallback={null}>
        <LoginForm searchParams={searchParams} t={dict.login} />
      </Suspense>
    </main>
  );
}
