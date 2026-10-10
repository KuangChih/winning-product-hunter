import { setWatched } from "@/app/[lang]/watchlist/actions";
import { cn } from "@/lib/utils";

/** Watch / unwatch toggle; a plain form posting to a Server Action, so it works without JS. */
export function WatchButton({
  productId,
  watched,
  labels = { watch: "☆ Watch", watching: "★ Watching" },
}: {
  productId: string;
  watched: boolean;
  labels?: { watch: string; watching: string };
}) {
  return (
    <form action={setWatched}>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="watch" value={watched ? "0" : "1"} />
      <button
        type="submit"
        aria-pressed={watched}
        className={cn(
          "h-9 rounded-md border px-3 text-sm font-medium",
          watched ? "bg-secondary" : "hover:bg-secondary",
        )}
      >
        {watched ? labels.watching : labels.watch}
      </button>
    </form>
  );
}
