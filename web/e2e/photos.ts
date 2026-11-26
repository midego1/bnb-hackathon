/** Test photos for the phone flow (stage and duo specs). */

/** A big noisy 24-bit BMP (~5.8 MB): JPEG cannot squeeze noise, so the phone's compression loop really has to work. */
export function noisyBmp(seed: number, w = 1600, h = 1200) {
  const row = Math.ceil((w * 3) / 4) * 4;
  const buf = Buffer.alloc(54 + row * h);
  buf.write("BM", 0);
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(row * h, 34);
  let x = seed;
  for (let i = 54; i < buf.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    buf[i] = x >> 16;
  }
  return { name: `photo-${seed}.bmp`, mimeType: "image/bmp", buffer: buf };
}
