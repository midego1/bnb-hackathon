/**
 * The LED numerals of the money board (MoneyFlow.tsx): a 5x9 dot font, row by row ("#" is a lit dot). Digits sit on
 * rows 1 to 7; the baht sign and the comma reach past them. The artwork's "฿6,800" (docs/marketing) uses the same font.
 */
const GLYPHS: Record<string, string[]> = {
  "0": ["", ".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["", "..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": ["", ".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["", "#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
  "4": ["", "...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["", "#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["", "..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["", "#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": ["", ".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": ["", ".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  ",": ["", "", "", "", "", "", "##", ".#", "#."],
  "฿": ["..#..", "####.", "#.#.#", "#.#.#", "####.", "#.#.#", "#.#.#", "####.", "..#.."],
};

/** The panel is as wide as the largest amount on the board ("฿10,200"), so it never changes size. */
export const LED_COLS = 38;
export const LED_ROWS = 9;
/** The characters the font can show (tests/marketing.test.ts checks every amount on the board against it). */
export const LED_CHARS = Object.keys(GLYPHS).join("");

const widthOf = (glyph: string[]) => Math.max(0, ...glyph.map((row) => row.length));

/**
 * The lit dots of an amount, flush right on the panel: [column, row] pairs. The panel is decoration over a text
 * amount, so it never throws: a character the font lacks is left blank, and dots that would fall off the panel are dropped.
 */
export function ledDots(text: string): [number, number][] {
  const glyphs = [...text].map((ch) => GLYPHS[ch] ?? []);
  let x = LED_COLS - glyphs.reduce((n, g) => n + widthOf(g) + 1, -1);
  const dots: [number, number][] = [];
  for (const g of glyphs) {
    g.forEach((row, y) => {
      for (let i = 0; i < row.length; i++) if (row[i] === "#" && x + i >= 0) dots.push([x + i, y]);
    });
    x += widthOf(g) + 1;
  }
  return dots;
}
