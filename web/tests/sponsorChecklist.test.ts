import { describe, expect, it } from "vitest";
import { sponsorsCopy } from "@/components/sponsors/copy";
import { SPONSOR_CHECKLIST } from "@/lib/sponsorChecklist";

describe("/sponsors checklist", () => {
  const rows = Object.values(SPONSOR_CHECKLIST).flat();

  it("gives every track rows, each row once, with words in English and Chinese", () => {
    expect(Object.keys(SPONSOR_CHECKLIST).sort()).toEqual(Object.keys(sponsorsCopy.en.tracks).sort());
    for (const list of Object.values(SPONSOR_CHECKLIST)) expect(list.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(Object.keys(sponsorsCopy.en.checklist.rows).sort()).toEqual(rows.map((r) => r.id).sort());
    for (const r of rows) expect(sponsorsCopy("zh").checklist.rows[r.id].ask).not.toBe(sponsorsCopy.en.checklist.rows[r.id].ask);
  });

  it("links every row to an absolute https URL or an app path", () => {
    for (const r of rows) expect(r.href, r.id).toMatch(/^(https:\/\/[^\s/]+\.[^\s/]+(\/\S*)?|\/[a-z][^\s]*)$/);
  });

  it("claims nothing that is not met: Cournot's live call and the 3-5 minute memory video stay pending", () => {
    const state = Object.fromEntries(rows.map((r) => [r.id, r.state]));
    expect(state).toMatchObject({ lbVideo: "pending", bnbRepo: "pending", bnbHackquest: "pending" });
    for (const r of rows.filter((r) => r.state === "pending")) expect(r.needs).toBeUndefined();
  });
});
