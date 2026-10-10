import { Package } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Product photo, or a neutral placeholder when there is none (many products have no photo
 * yet). A plain <img>: the photos come from store CDNs that are not configured for next/image.
 * Decorative (`alt=""`): the product name is always next to it.
 */
export function ProductThumb({
  src,
  size = "md",
  className,
}: {
  src: string | null | undefined;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const box = cn(
    "bg-muted shrink-0 overflow-hidden rounded-md border",
    size === "sm" && "size-10",
    size === "md" && "size-14",
    size === "lg" && "size-24",
    className,
  );
  if (!src) {
    return (
      <span className={cn(box, "text-muted-foreground flex items-center justify-center")}>
        <Package aria-hidden className="size-1/2" strokeWidth={1.5} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote store photos, see above
    <img src={src} alt="" loading="lazy" decoding="async" className={cn(box, "object-cover")} />
  );
}
