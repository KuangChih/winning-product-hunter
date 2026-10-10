import { Star } from "lucide-react";
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

/**
 * The same toggle as a star icon, for lists. `label` names the product ("Watch Neck Fan") and
 * stays the same either way (`aria-pressed` tells the state); `tooltip` says what a click does.
 */
export function WatchStar({
  productId,
  watched,
  label,
  tooltip,
}: {
  productId: string;
  watched: boolean;
  label: string;
  tooltip: string;
}) {
  return (
    <form action={setWatched}>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="watch" value={watched ? "0" : "1"} />
      <button
        type="submit"
        aria-pressed={watched}
        aria-label={label}
        title={tooltip}
        className="hover:bg-secondary text-muted-foreground flex size-9 items-center justify-center rounded-md"
      >
        <Star
          aria-hidden
          className={cn("size-5", watched && "fill-amber-400 text-amber-500")}
          strokeWidth={1.75}
        />
      </button>
    </form>
  );
}
