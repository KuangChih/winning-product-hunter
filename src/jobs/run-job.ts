import { closeDb } from "@/db/client";

/** Runs a CLI job, reports errors, and always releases the database so the process exits. */
export function runJob(main: () => Promise<void>): void {
  main()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
