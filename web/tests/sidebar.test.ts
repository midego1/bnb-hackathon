import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSidebarSnapshot, setSidebar, SIDEBAR_INIT_SCRIPT, SIDEBAR_STORAGE_KEY, subscribeSidebar, syncSidebarToRoute } from "@/lib/sidebar";

/** A tiny stand-in for <html> and localStorage (the tests run in node). */
function fakeBrowser({ storageThrows = false } = {}) {
  const store = new Map<string, string>();
  const documentElement = { dataset: {} as Record<string, string> };
  const localStorage = {
    getItem: (k: string) => {
      if (storageThrows) throw new Error("blocked");
      return store.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (storageThrows) throw new Error("blocked");
      store.set(k, v);
    },
  };
  vi.stubGlobal("document", { documentElement });
  vi.stubGlobal("window", { localStorage });
  return { store, html: documentElement };
}

const runInit = (pathname: string) => new Function("location", SIDEBAR_INIT_SCRIPT)({ pathname });

describe("sidebar state", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("starts expanded, remembers a collapse, and the stages always open collapsed", () => {
    const { store, html } = fakeBrowser();
    runInit("/tenant");
    expect(html.dataset.sidebar).toBe("expanded");

    setSidebar("collapsed", "/tenant");
    expect(store.get(SIDEBAR_STORAGE_KEY)).toBe("collapsed");
    runInit("/backoffice");
    expect(html.dataset.sidebar).toBe("collapsed");

    setSidebar("expanded", "/backoffice");
    runInit("/demo");
    expect(html.dataset.sidebar).toBe("collapsed");
    runInit("/how-it-works");
    expect(html.dataset.sidebar).toBe("collapsed");
    runInit("/demonstration"); // only the routes themselves, not lookalike prefixes
    expect(html.dataset.sidebar).toBe("expanded");
  });

  it("toggling on a stage lasts for the visit; navigating restores the remembered choice", () => {
    const { store } = fakeBrowser();
    const changes = vi.fn();
    subscribeSidebar(changes);
    syncSidebarToRoute("/demo");
    expect(getSidebarSnapshot()).toBe("collapsed");
    setSidebar("expanded", "/demo");
    expect(getSidebarSnapshot()).toBe("expanded");
    expect(store.has(SIDEBAR_STORAGE_KEY)).toBe(false);
    syncSidebarToRoute("/how-it-works");
    expect(getSidebarSnapshot()).toBe("collapsed");
    syncSidebarToRoute("/landlord");
    expect(getSidebarSnapshot()).toBe("expanded");
    expect(changes).toHaveBeenCalledTimes(4);
  });

  it("works without storage (private mode, blocked site data)", () => {
    const { html } = fakeBrowser({ storageThrows: true });
    runInit("/");
    expect(html.dataset.sidebar).toBe("expanded");
    expect(() => setSidebar("collapsed", "/")).not.toThrow();
    expect(getSidebarSnapshot()).toBe("collapsed");
  });
});
