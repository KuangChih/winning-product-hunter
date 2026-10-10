"use client";

import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { startDiscovery, startErrorMessage } from "@/lib/discovery-client";
import type { DiscoverLabels } from "./run-progress";
import { buttonVariants } from "./ui/button";

/** Starts discovery with the rotating keywords, then opens the discovery page to follow it. */
export function StartDiscoveryButton({ labels }: { labels: DiscoverLabels }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const result = await startDiscovery("");
          // Reset before leaving: Cache Components keep this page alive (hidden) for "back".
          setBusy(false);
          if (!result.ok) {
            setError(startErrorMessage(result, labels));
            return;
          }
          router.push("/discover");
          // The page we leave now has a run in progress; show that when the user comes back.
          router.refresh();
        }}
        className={buttonVariants({ size: "lg", className: "h-10 px-4" })}
      >
        <Play aria-hidden />
        {busy ? labels.starting : labels.start}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
