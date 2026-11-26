"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { LandingCopy } from "./copy";
import { SearchIcon } from "./icons";

export type SearchValue = { where: string; when: string; how: string };

/**
 * The hero's search: where, when, how long. A plain GET form to /#listings, so it works without JavaScript (the server
 * filters the grid, lib/marketing.ts parseSearch); in the browser it changes the address without a reload and brings
 * the grid into view. On phones the bar is one pill that sums up the choice and opens the fields when tapped: the
 * collapse is CSS (landing.css), so nothing moves on hydration.
 */
export function Search({ labels, cities, today, initial }: { labels: LandingCopy["search"]; cities: [value: string, label: string][]; today: string; initial: SearchValue }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [open, setOpen] = useState(false);
  const set = (key: keyof SearchValue) => (e: { target: { value: string } }) => setV({ ...v, [key]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = new URLSearchParams();
    if (v.where) q.set("where", v.where);
    if (v.when) q.set("when", v.when);
    if (v.how !== "day") q.set("how", v.how);
    const qs = q.toString();
    router.push(`/${qs ? `?${qs}` : ""}#listings`, { scroll: false });
    setOpen(false);
    // The page scrolls smoothly, except under reduced motion (landing.css).
    document.getElementById("listings")?.scrollIntoView();
  };

  const lengths = Object.entries(labels.lengths);
  const summary = [cities.find(([value]) => value === v.where)?.[1] ?? labels.anywhereShort, v.when || labels.anyDate, labels.lengths[v.how as keyof typeof labels.lengths] ?? labels.lengths.day];
  return (
    <form method="get" action="/#listings" role="search" aria-label={labels.label} className="mk-search" data-open={open || undefined} data-testid="mk-search" onSubmit={submit}>
      <button type="button" className="mk-search-pill" aria-expanded={open} aria-controls="mk-search-fields" data-testid="mk-search-pill" onClick={() => setOpen(!open)}>
        <SearchIcon />
        <span>
          <span className="sr-only">{labels.label}: </span>
          {summary.join(" · ")}
        </span>
      </button>
      <div id="mk-search-fields" className="mk-search-fields">
        <label>
          <span>{labels.where}</span>
          <select name="where" value={v.where} onChange={set("where")}>
            <option value="">{labels.anywhere}</option>
            {cities.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{labels.when}</span>
          <input type="date" name="when" min={today} value={v.when} onChange={set("when")} />
        </label>
        <label>
          <span>{labels.how}</span>
          <select name="how" value={v.how} onChange={set("how")}>
            {lengths.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="mk-search-go" data-testid="mk-search-go">
          <SearchIcon />
          {labels.submit}
        </button>
      </div>
    </form>
  );
}
