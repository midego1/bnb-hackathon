import config from "@/data/listings.json";

/**
 * Physical items anyone can rent on stage (the live judge demo): /app/listings/<slug>, /stage/<slug>, /r/<slug>.
 * Edited in web/data/listings.json; amounts in THB, converted to mUSDT when the server creates the rental.
 */
export type Listing = {
  slug: string;
  name: string;
  description: string;
  location: string;
  photos: string[];
  rentThb: number;
  depositThb: number;
};

export const LISTINGS: Listing[] = config.listings;
/** Fixed demo rate for pricing stage rentals in mUSDT. shortcut: not the live CMC rate; switch to the price service if the Worker has room. */
export const LISTING_THB_PER_USDT: number = config.thbPerUsdt;

export const getListing = (slug: string): Listing | undefined => LISTINGS.find((l) => l.slug === slug);
