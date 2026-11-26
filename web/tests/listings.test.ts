import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET as getAll } from "@/app/api/listings/route";
import { GET as getOne } from "@/app/api/listings/[slug]/route";
import { LISTING_PHOTOS, LISTINGS, photoSrcSet } from "@/lib/listings";

/** The one catalogue of the website and the iOS app (web/data/listings.json) and GET /api/listings. */
const pub = path.resolve(import.meta.dirname, "../public");
// Free to use in a public repo and an app: no non-commercial or no-derivatives clause.
const LICENCES: Record<string, string> = {
  "CC0 1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
  "CC BY 2.0": "https://creativecommons.org/licenses/by/2.0/",
  "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
  "CC BY-SA 3.0": "https://creativecommons.org/licenses/by-sa/3.0/",
  "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
};

describe("listing catalogue", () => {
  it("has unique slugs, prices above zero, and the web's slugs", () => {
    expect(new Set(LISTINGS.map((l) => l.slug)).size).toBe(LISTINGS.length);
    for (const l of LISTINGS) {
      expect(l.slug, l.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(l.rentThb, l.slug).toBeGreaterThan(0);
      expect(l.depositThb, l.slug).toBeGreaterThan(0);
      if (l.monthThb !== undefined) expect(l.monthThb, l.slug).toBeGreaterThan(0);
    }
    // /app/listings/<slug>, /api/stage/<slug> and the iOS app use these: renaming one breaks links and open rentals.
    for (const slug of ["honda-click-125i", "yamaha-nmax-155", "vespa-primavera-150", "honda-pcx-160", "honda-scoopy", "yamaha-grand-filano", "mystery-box"]) {
      expect(LISTINGS.map((l) => l.slug)).toContain(slug);
    }
  });

  it("gives every listing a real photo, on disk in every size and format, with a full credit", () => {
    for (const l of LISTINGS) {
      expect(l.photos.length, l.slug).toBeGreaterThan(0);
      for (const src of l.photos) {
        const p = LISTING_PHOTOS[src];
        expect(p, `${l.slug}: ${src}`).toBeDefined();
        expect(src).toMatch(/^\/listings\/photos\/[a-z0-9-]+-1200\.jpg$/);
        for (const ext of ["avif", "webp", "jpg"] as const) {
          for (const entry of photoSrcSet(src, ext).split(", ")) expect(existsSync(path.join(pub, entry.split(" ")[0])), entry).toBe(true);
        }
        expect([p.width, p.height]).toEqual([1200, 900]);
        expect(p.alt.length, src).toBeGreaterThan(10);
        const c = p.credit;
        expect(c.title && c.author && c.changes, src).toBeTruthy();
        expect(LICENCES[c.license], `${src}: ${c.license}`).toBe(c.licenseUrl);
        expect(c.source, src).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      }
    }
    // No credit for a photo nobody shows.
    expect(Object.keys(LISTING_PHOTOS).sort()).toEqual(LISTINGS.flatMap((l) => l.photos).sort());
  });
});

describe("GET /api/listings", () => {
  it("answers the catalogue with absolute photo URLs on the caller's host, cacheable for 5 minutes", async () => {
    const res = getAll(new Request("https://keyescrow.example/api/listings"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const body = await res.json();
    expect(body.thbPerUsdt).toBe(33);
    expect(body.listings.map((l: { slug: string }) => l.slug)).toEqual(LISTINGS.map((l) => l.slug));
    const click = body.listings.find((l: { slug: string }) => l.slug === "honda-click-125i");
    expect(Object.keys(click).sort()).toEqual(["area", "city", "demo", "depositThb", "description", "location", "monthThb", "name", "photos", "rentThb", "slug", "stage"]);
    expect(click).toMatchObject({ name: "Honda Click 125i", city: "Chiang Mai", area: "Nimman", rentThb: 250, monthThb: 3400, depositThb: 6800, stage: false, demo: true });
    expect(click.photos[0]).toMatchObject({ url: "https://keyescrow.example/listings/photos/honda-click-125i-1200.jpg", width: 1200, height: 900 });
    expect(Object.keys(click.photos[0].credit).sort()).toEqual(["author", "changes", "license", "licenseUrl", "note", "source", "title"]);
    const box = body.listings.find((l: { slug: string }) => l.slug === "mystery-box");
    expect(box).toMatchObject({ stage: true, demo: false, monthThb: null, area: null });
  });

  it("answers one listing by slug, or 404", async () => {
    const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
    const one = await getOne(new Request("http://127.0.0.1:3000/api/listings/yamaha-fino-125"), ctx("yamaha-fino-125"));
    expect(one.headers.get("cache-control")).toBe("public, max-age=300");
    const fino = await one.json();
    expect(fino).toMatchObject({ slug: "yamaha-fino-125", city: "Bangkok", stage: false });
    expect(fino.photos[0].url).toBe("http://127.0.0.1:3000/listings/photos/yamaha-fino-125-1200.jpg");
    // Next names its own bind address in request.url; the answer uses the host the caller asked.
    const proxied = await getOne(new Request("http://localhost:3000/api/listings/honda-scoopy", { headers: { host: "127.0.0.1:3150" } }), ctx("honda-scoopy"));
    expect((await proxied.json()).photos[0].url).toBe("http://127.0.0.1:3150/listings/photos/honda-scoopy-1200.jpg");
    const none = await getOne(new Request("http://127.0.0.1:3000/api/listings/nope"), ctx("nope"));
    expect(none.status).toBe(404);
    expect(await none.json()).toEqual({ error: "There is no such listing." });
  });
});
