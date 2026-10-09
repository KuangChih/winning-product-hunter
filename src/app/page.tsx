import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-4 px-4 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">Winning Product Hunter</h1>
      <p className="text-muted-foreground text-lg">
        Find products that are selling right now, backed by evidence from ads, search trends and
        marketplaces.
      </p>
      <div>
        <Link href="/products" className={buttonVariants({ size: "lg" })}>
          See winning products
        </Link>
      </div>
    </main>
  );
}
