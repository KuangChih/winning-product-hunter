"use server";

import { refresh } from "next/cache";
import { addToWatchlist, removeFromWatchlist } from "@/data/watchlist";
import { getDb, isDatabaseConfigured } from "@/db/client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Adds or removes a product (the form says which), then refreshes the current page. */
export async function setWatched(formData: FormData) {
  const productId = String(formData.get("productId") ?? "");
  if (!UUID.test(productId) || !isDatabaseConfigured()) return;
  const db = await getDb();
  if (formData.get("watch") === "1") {
    await addToWatchlist(db, productId);
  } else {
    await removeFromWatchlist(db, productId);
  }
  refresh();
}
