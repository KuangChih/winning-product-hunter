// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginFailures } from "@/db/schema";
import { createTestDb } from "@/db/testing/pglite";
import {
  clearLoginFailures,
  clientAddress,
  clientHash,
  isLoginThrottled,
  LOGIN_LIMITS,
  recordLoginFailure,
} from "./login-throttle";

const NOW = new Date("2026-10-10T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe("login throttle", () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  const fail = async (hash: string, times: number, at = NOW) => {
    for (let i = 0; i < times; i++) await recordLoginFailure(t.db, hash, at);
  };

  it("blocks a client after too many recent failures", async () => {
    await fail("a", LOGIN_LIMITS.perClient - 1);
    expect(await isLoginThrottled(t.db, "a", NOW)).toBe(false);
    await fail("a", 1);
    expect(await isLoginThrottled(t.db, "a", NOW)).toBe(true);
    // Other clients are unaffected.
    expect(await isLoginThrottled(t.db, "b", NOW)).toBe(false);
  });

  it("forgets failures outside the window and prunes old rows", async () => {
    await fail("a", LOGIN_LIMITS.perClient, minutesAgo(16));
    expect(await isLoginThrottled(t.db, "a", NOW)).toBe(false);

    await fail("a", 1, minutesAgo(25 * 60));
    await fail("a", 1, NOW);
    const rows = await t.db.select().from(loginFailures);
    expect(rows.every((r) => r.failedAt > minutesAgo(24 * 60))).toBe(true);
  });

  it("blocks everyone when failures across all clients pass the global limit", async () => {
    for (let i = 0; i < LOGIN_LIMITS.global / 10; i++) await fail(`ip-${i}`, 10);
    expect(await isLoginThrottled(t.db, "fresh-client", NOW)).toBe(true);
  });

  it("clears a client's failures after a successful login", async () => {
    await fail("a", LOGIN_LIMITS.perClient);
    await clearLoginFailures(t.db, "a");
    expect(await isLoginThrottled(t.db, "a", NOW)).toBe(false);
  });
});

describe("client identification", () => {
  it("uses the first forwarded address, then x-real-ip", () => {
    expect(clientAddress(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe(
      "203.0.113.5",
    );
    expect(clientAddress(new Headers({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientAddress(new Headers())).toBe("unknown");
  });

  it("hashes addresses with a salt, never storing them in the clear", async () => {
    const h = await clientHash("203.0.113.5", "salt");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("203");
    expect(await clientHash("203.0.113.5", "other")).not.toBe(h);
  });
});
