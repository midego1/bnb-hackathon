import type { ReactNode } from "react";
import { boxes, columns, inputs, type Recipe, type RecipeText } from "@/lib/recipes";

type Labels = { ingredients: string; steps: string; combines: string };

/**
 * "How it works" as a recipe card, read left to right: the ingredients down the left, every box to the right combines
 * everything to its left that it spans, the last column is the result. A CSS grid placed from lib/recipes.ts (no client
 * code); under 640 px (not on an unfolded foldable) it is a list: the ingredients, then the numbered steps.
 */
export function RecipeGrid({ id, recipe, text, title, labels }: { id: string; recipe: Recipe; text: RecipeText; title: ReactNode; labels: Labels }) {
  const ing = text.ingredients as Record<string, readonly [string, string]>;
  const step = text.steps as Record<string, readonly [string, string]>;
  const last = recipe.steps.at(-1)!.id;
  const n = columns(recipe);
  const name = (b: { id: string; kind: string }) => (b.kind === "step" ? step[b.id][0] : ing[b.id][1]);
  // Short amounts ("฿250", "1–3") get a narrow column, so the names have room.
  const amount = Object.values(ing).some(([a]) => a.length > 8) ? "w-24 lg:w-28" : "w-14";
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-10" data-testid="recipe" data-recipe={id}>
      <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">{text.sub}</p>

      <div
        className="hidden gap-px overflow-hidden rounded-md border border-border-strong bg-border-strong text-sm sm:grid fold:grid"
        style={{ gridTemplateColumns: `minmax(10rem, 2fr) repeat(${n - 2}, minmax(0, 1fr)) minmax(0, 1.4fr)` }}
        data-testid="recipe-grid"
      >
        {boxes(recipe).map((b) => {
          const place = { gridRow: `${b.row} / ${b.rowEnd + 1}`, gridColumn: `${b.col} / ${b.colEnd + 1}` };
          if (b.kind === "ingredient")
            return (
              <div key={`i-${b.id}`} style={place} className="flex items-center gap-3 bg-warning-soft px-3 py-2.5" data-testid="recipe-ingredient">
                <span className={`${amount} shrink-0 font-semibold text-warning-fg`}>{ing[b.id][0]}</span>
                <span className="min-w-0">{ing[b.id][1]}</span>
              </div>
            );
          const final = b.id === last;
          return (
            <div
              key={`s-${b.id}`}
              style={place}
              className={`flex flex-col items-center justify-center px-2 py-2.5 text-center break-words ${final ? "bg-success-soft text-success-fg" : "bg-surface"}`}
              data-testid="recipe-step"
              data-step={b.id}
            >
              <span className="font-semibold">{step[b.id][0]}</span>
              <span className={`mt-0.5 text-xs ${final ? "" : "text-muted-foreground"}`}>{step[b.id][1]}</span>
            </div>
          );
        })}
      </div>

      <div className="text-sm sm:hidden fold:hidden" data-testid="recipe-list">
        <h3 className="text-xs font-semibold text-subtle">{labels.ingredients}</h3>
        <ul className="mt-1 divide-y divide-border-strong overflow-hidden rounded-lg border border-border-strong bg-warning-soft">
          {recipe.ingredients.map((i) => (
            <li key={i} className="flex gap-3 px-3 py-2">
              <span className={`${amount} shrink-0 font-semibold text-warning-fg`}>{ing[i][0]}</span>
              <span className="min-w-0">{ing[i][1]}</span>
            </li>
          ))}
        </ul>
        <h3 className="mt-4 text-xs font-semibold text-subtle">{labels.steps}</h3>
        <ol className="mt-1 divide-y divide-border-strong overflow-hidden rounded-lg border border-border-strong">
          {recipe.steps.map((s, k) => (
            <li key={s.id} className={`px-3 py-2 ${s.id === last ? "bg-success-soft text-success-fg" : "bg-surface"}`}>
              <p>
                <span className="font-semibold">
                  {k + 1}. {step[s.id][0]}
                </span>{" "}
                <span className={s.id === last ? "" : "text-muted-foreground"}>{step[s.id][1]}</span>
              </p>
              <p className="mt-0.5 text-xs text-subtle">
                {labels.combines}: {inputs(recipe, s.id).map(name).join(" + ")}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
