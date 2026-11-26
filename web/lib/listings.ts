import config from "@/data/listings.json";

/**
 * The one catalogue of the website and the iOS app (GET /api/listings): the Mystery Box of the live judge demo
 * (/stage/<slug>, /r/<slug>) and the demo scooter listings of the landing page grid. Each has a page at
 * /app/listings/<slug>. Edited in web/data/listings.json; amounts in THB, converted to mUSDT when the server creates
 * the rental.
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
  /** Paths of the 1200 px JPEG of each photo (`/listings/photos/<name>-1200.jpg`); LISTING_PHOTOS has its credit. */
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

/** Where a photo comes from (Wikimedia Commons), as its licence asks us to say it. Listed on /credits. */
export type PhotoCredit = {
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
  /** The file's own page on Commons, where the licence is stated. */
  source: string;
  /** What we changed. */
  changes: string;
  /** Where the picture is a stand-in (another model year, another place). */
  note?: string;
};
export type ListingPhoto = { width: number; height: number; alt: string; credit: PhotoCredit };

export const LISTINGS: Listing[] = config.listings;
/** Every catalogue photo by its path (a listing's `photos` entry). */
export const LISTING_PHOTOS: Record<string, ListingPhoto> = config.photos;
/** `srcset` of a catalogue photo in one format: its 480, 960 and 1200 px files. */
export const photoSrcSet = (src: string, ext: "avif" | "webp" | "jpg") =>
  [480, 960, 1200].map((w) => `${src.replace(/-1200\.jpg$/, `-${w}.${ext}`)} ${w}w`).join(", ");
/** Fixed demo rate for pricing stage rentals in mUSDT. shortcut: not the live CMC rate; switch to the price service if the Worker has room. */
export const LISTING_THB_PER_USDT: number = config.thbPerUsdt;

export const getListing = (slug: string): Listing | undefined => LISTINGS.find((l) => l.slug === slug);

/** A listing as GET /api/listings answers it: photo URLs absolute on `origin`, every photo with its credit. */
export function listingJson(l: Listing, origin: string) {
  return {
    slug: l.slug,
    name: l.name,
    description: l.description,
    location: l.location,
    city: l.city,
    area: l.area ?? null,
    rentThb: l.rentThb,
    monthThb: l.monthThb ?? null,
    depositThb: l.depositThb,
    stage: !!l.stage,
    /** A made-up offer to try the rental flow with (the scooters); the stage item is a real box. */
    demo: !l.stage,
    photos: l.photos.map((src) => ({ url: new URL(src, origin).href, ...LISTING_PHOTOS[src] })),
  };
}
