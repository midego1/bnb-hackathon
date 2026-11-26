/**
 * "How it works" as a recipe card (components/RecipeGrid.tsx): ingredients down the left, and every step to the right
 * combines everything to its left that it spans. Only the layout lives here; the words are in the pages' copy files.
 * Rows are 1-based ingredient rows; column 1 is the ingredients, so steps start at column 2.
 */
export type RecipeStep<S extends string> = { id: S; col: number; cols?: number; rows: readonly [from: number, to: number] };
export type Recipe<I extends string = string, S extends string = string> = { ingredients: readonly I[]; steps: readonly RecipeStep<S>[] };
export type RecipeText<I extends string = string, S extends string = string> = {
  title: string;
  sub: string;
  ingredients: Record<I, readonly [amount: string, item: string]>;
  /** The last step is the final (green) cell. */
  steps: Record<S, readonly [verb: string, how: string]>;
};

/** A cell's box on the grid: rows and columns are 1-based and inclusive. */
export type Box = { id: string; kind: "ingredient" | "step"; row: number; rowEnd: number; col: number; colEnd: number };

export const columns = (r: Recipe) => Math.max(...r.steps.map((s) => s.col + (s.cols ?? 1) - 1));

/** Every cell: a step as given, and an ingredient stretched right up to the first step that uses it. */
export function boxes(r: Recipe): Box[] {
  const steps = r.steps.map((s): Box => ({ id: s.id, kind: "step", row: s.rows[0], rowEnd: s.rows[1], col: s.col, colEnd: s.col + (s.cols ?? 1) - 1 }));
  const ingredients = r.ingredients.map((id, i): Box => {
    const row = i + 1;
    const used = steps.filter((s) => s.row <= row && row <= s.rowEnd).map((s) => s.col);
    return { id, kind: "ingredient", row, rowEnd: row, col: 1, colEnd: (used.length ? Math.min(...used) : columns(r) + 1) - 1 };
  });
  return [...ingredients, ...steps];
}

/** What a step combines: the cells that end right at its left edge, inside its rows. */
export const inputs = (r: Recipe, step: string) => {
  const all = boxes(r);
  const s = all.find((b) => b.kind === "step" && b.id === step)!;
  return all.filter((b) => b.colEnd === s.col - 1 && b.row >= s.row && b.rowEnd <= s.rowEnd);
};

/** /media: one rental, from the offer to the settlement (docs/PRODUCT.md). */
export const RENTAL_RECIPE = {
  ingredients: ["deposit", "rent", "escrow", "pickup", "return", "inspector", "price", "owner", "timeout", "fee"],
  steps: [
    { id: "offer", col: 2, rows: [1, 3] },
    { id: "fund", col: 3, cols: 2, rows: [1, 3] },
    { id: "anchor", col: 3, rows: [4, 5] },
    { id: "inspect", col: 4, rows: [4, 6] },
    { id: "propose", col: 5, rows: [1, 7] },
    { id: "accept", col: 6, rows: [1, 9] },
    { id: "settle", col: 7, rows: [1, 10] },
  ],
} as const satisfies Recipe;

/** /sponsors: what each sponsor brings and where it goes in. */
export const SPONSOR_RECIPE = {
  ingredients: ["atlasPush", "cmc", "cournot", "atlasPull", "livingBrain", "claude", "erc8004", "bnb"],
  steps: [
    { id: "price", col: 2, rows: [1, 2] },
    { id: "buffer", col: 3, rows: [1, 3] },
    { id: "guard", col: 4, rows: [1, 4] },
    { id: "remember", col: 2, cols: 3, rows: [5, 5] },
    { id: "inspect", col: 2, cols: 3, rows: [6, 7] },
    { id: "escrow", col: 5, rows: [1, 8] },
  ],
} as const satisfies Recipe;

type Ids<R extends Recipe> = [R["ingredients"][number], R["steps"][number]["id"]];
export type RentalRecipeText = RecipeText<Ids<typeof RENTAL_RECIPE>[0], Ids<typeof RENTAL_RECIPE>[1]>;
export type SponsorRecipeText = RecipeText<Ids<typeof SPONSOR_RECIPE>[0], Ids<typeof SPONSOR_RECIPE>[1]>;
