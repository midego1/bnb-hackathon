import { describe, expect, it } from "vitest";
import { mediaCopy } from "@/components/media/copy";
import { sponsorsCopy } from "@/components/sponsors/copy";
import { boxes, columns, inputs, RENTAL_RECIPE, SPONSOR_RECIPE, type Recipe } from "@/lib/recipes";

const RECIPES = [
  ["rental", RENTAL_RECIPE, [mediaCopy.en.recipe, mediaCopy("zh").recipe]],
  ["sponsors", SPONSOR_RECIPE, [sponsorsCopy.en.recipe, sponsorsCopy("zh").recipe]],
] as const;

describe.each(RECIPES)("%s recipe", (_, recipe: Recipe, texts) => {
  const rows = recipe.ingredients.length;
  const cols = columns(recipe);

  it("every step stays inside the grid, and the cells tile it with no gap or overlap", () => {
    const grid = Array.from({ length: rows }, () => Array<string | null>(cols).fill(null));
    for (const b of boxes(recipe)) {
      expect(b.row).toBeGreaterThanOrEqual(1);
      expect(b.rowEnd).toBeLessThanOrEqual(rows);
      expect(b.row).toBeLessThanOrEqual(b.rowEnd);
      expect(b.col).toBeLessThanOrEqual(b.colEnd);
      if (b.kind === "step") expect(b.col).toBeGreaterThanOrEqual(2);
      for (let r = b.row; r <= b.rowEnd; r++)
        for (let c = b.col; c <= b.colEnd; c++) {
          expect(grid[r - 1][c - 1], `${b.id} overlaps at ${r},${c}`).toBeNull();
          grid[r - 1][c - 1] = b.id;
        }
    }
    expect(grid.flat().filter((x) => x === null)).toEqual([]);
  });

  it("every ingredient is used by a step, and the last step (the result) spans every row", () => {
    const used = new Set(recipe.steps.flatMap((s) => inputs(recipe, s.id).map((b) => b.id)));
    for (const i of recipe.ingredients) expect(used, i).toContain(i);
    const last = recipe.steps.at(-1)!;
    expect(last.rows).toEqual([1, rows]);
    expect(last.col + (last.cols ?? 1) - 1).toBe(cols);
    // Every step but the last feeds a later one.
    for (const s of recipe.steps.slice(0, -1)) expect(used, s.id).toContain(s.id);
  });

  it("has words for every ingredient and step in en and zh", () => {
    for (const text of texts) {
      expect(Object.keys(text.ingredients).sort()).toEqual([...recipe.ingredients].sort());
      expect(Object.keys(text.steps).sort()).toEqual(recipe.steps.map((s) => s.id).sort());
    }
    expect(texts[1].title).not.toBe(texts[0].title);
  });
});

it("the rental recipe combines what the flow needs", () => {
  const of = (s: string) => inputs(RENTAL_RECIPE, s).map((b) => b.id);
  expect(of("anchor")).toEqual(["pickup", "return"]);
  expect(of("inspect")).toEqual(["inspector", "anchor"]);
  expect(of("propose")).toEqual(["price", "fund", "inspect"]);
  expect(of("accept")).toEqual(["owner", "timeout", "propose"]);
  expect(of("settle")).toEqual(["fee", "accept"]);
});
