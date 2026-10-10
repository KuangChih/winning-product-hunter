// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  checkCronAuth,
  checkPipelineAuth,
  isCronConfigured,
  pipelineTickToken,
} from "./internal-auth";

describe("internal API auth", () => {
  it("derives the tick token from CRON_SECRET, else DATABASE_URL", async () => {
    const fromDb = await pipelineTickToken({ DATABASE_URL: "postgres://x" });
    const fromCron = await pipelineTickToken({ DATABASE_URL: "postgres://x", CRON_SECRET: "c" });
    expect(fromDb).toMatch(/^[0-9a-f]{64}$/);
    expect(fromCron).toMatch(/^[0-9a-f]{64}$/);
    expect(fromCron).not.toBe(fromDb);
    expect(await pipelineTickToken({})).toBeNull();
  });

  it("checks the tick Bearer token", async () => {
    const env = { DATABASE_URL: "pglite:./.data/dev" };
    const token = await pipelineTickToken(env);
    expect(await checkPipelineAuth(`Bearer ${token}`, env)).toBe("ok");
    expect(await checkPipelineAuth(`Bearer ${token}x`, env)).toBe("unauthorized");
    expect(await checkPipelineAuth(token, env)).toBe("unauthorized");
    expect(await checkPipelineAuth(null, env)).toBe("unauthorized");
    // The raw secret is not the token.
    expect(await checkPipelineAuth(`Bearer ${env.DATABASE_URL}`, env)).toBe("unauthorized");
    expect(await checkPipelineAuth(`Bearer ${token}`, {})).toBe("unconfigured");
  });

  it("requires CRON_SECRET for the cron", async () => {
    expect(isCronConfigured({})).toBe(false);
    expect(await checkCronAuth("Bearer anything", { DATABASE_URL: "x" })).toBe("unconfigured");
    const env = { CRON_SECRET: "s3cret" };
    expect(isCronConfigured(env)).toBe(true);
    expect(await checkCronAuth("Bearer s3cret", env)).toBe("ok");
    expect(await checkCronAuth("Bearer wrong", env)).toBe("unauthorized");
    expect(await checkCronAuth("s3cret", env)).toBe("unauthorized");
    expect(await checkCronAuth(null, env)).toBe("unauthorized");
  });
});
