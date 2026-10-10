import type { Metadata } from "next";
import { Suspense } from "react";
import { login } from "./actions";

export const metadata: Metadata = {
  title: "Sign in · Winning Product Hunter",
  robots: { index: false },
};

async function LoginForm({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";
  const failed = params.error === "1";
  const locked = params.error === "locked";
  const error = failed
    ? "That password is not correct."
    : locked
      ? "Too many failed attempts. Please wait 15 minutes and try again."
      : null;
  return (
    <form action={login} className="mt-6 space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1 text-sm">
        <span>Password</span>
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
        Sign in
      </button>
    </form>
  );
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-20"
    >
      <h1 className="text-2xl font-semibold tracking-tight">Winning Product Hunter</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        This site is private. Enter the password to continue.
      </p>
      <Suspense fallback={null}>
        <LoginForm searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
