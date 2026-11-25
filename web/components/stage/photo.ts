/**
 * Phone photo -> a JPEG of at most `maxBytes` (default 200 KB), so it uploads fast on venue Wi-Fi and fits the
 * Durable Object evidence store. Loaded only when the judge takes a photo (dynamic import), not with the page.
 */
export const MAX_PHOTO_BYTES = 200_000;

/** Long side in px and JPEG quality, tried in order until the result fits. */
export const ATTEMPTS: [number, number][] = [
  [1280, 0.8],
  [1280, 0.6],
  [960, 0.6],
  [720, 0.55],
  [480, 0.5],
  [320, 0.45],
];

/** The first encoding that fits `maxBytes`. Pure over `encode`, so tests/stage.test.ts checks it without a canvas. */
export async function fitUnder(maxBytes: number, encode: (longSide: number, quality: number) => Promise<Blob>): Promise<Blob> {
  for (const [side, q] of ATTEMPTS) {
    const b = await encode(side, q);
    if (b.size <= maxBytes) return b;
  }
  throw new Error("This photo could not be made small enough. Try again.");
}

export async function compressPhoto(file: File, maxBytes = MAX_PHOTO_BYTES): Promise<File> {
  const bmp = await createImageBitmap(file);
  try {
    const blob = await fitUnder(maxBytes, async (side, q) => {
      const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      return new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Could not read this photo."))), "image/jpeg", q));
    });
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "photo"}.jpg`, { type: "image/jpeg" });
  } finally {
    bmp.close();
  }
}
