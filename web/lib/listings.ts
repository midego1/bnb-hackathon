import config from "@/data/listings.json";

/**
 * Things anyone can rent: the Mystery Box of the live judge demo (/stage/<slug>, /r/<slug>) and the demo scooter
 * listings of the landing page grid. Each has a page at /app/listings/<slug>. Edited in web/data/listings.json;
 * amounts in THB, converted to mUSDT when the server creates the rental.
 */
export type Listing = {
  slug: string;
  name: string;
  description: string;
  /** Where it is, in full ("Nimman, Chiang Mai"); `area` and `city` are its two parts, when it has them. */
  location: string;
  area?: string;
  /** The city the landing page's search filters by. */
  city: string;
  photos: string[];
  /** Rent per day: what the first payment into the escrow is. */
  rentThb: number;
  /** Rent per month, when the owner offers one. */
  monthThb?: number;
  depositThb: number;
  /** The item of the live stage demo: rented from a phone at /r/<slug> while /stage/<slug> follows it. */
  stage?: boolean;
};

/** The cities of the demo listings, in the order the landing page's search offers them. */
export const LISTING_CITIES = ["Chiang Mai", "Bangkok", "Phuket", "Pai"] as const;

export const LISTINGS: Listing[] = config.listings;
/** Fixed demo rate for pricing stage rentals in mUSDT. shortcut: not the live CMC rate; switch to the price service if the Worker has room. */
export const LISTING_THB_PER_USDT: number = config.thbPerUsdt;

export const getListing = (slug: string): Listing | undefined => LISTINGS.find((l) => l.slug === slug);
