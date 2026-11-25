/**
 * Desktop sidebar: expanded (labels) or collapsed to an icon rail. <html data-sidebar="expanded|collapsed"> drives the
 * layout through CSS (the `rail:` variant in app/globals.css), so the server markup never depends on the state and
 * SIDEBAR_INIT_SCRIPT sets it in <head> before first paint (no jump on load).
 *
 * The user's choice is kept in localStorage. The one-screen stages (/demo, /how-it-works) always open with the rail
 * collapsed so the stage keeps its width; toggling there lasts for that visit only.
 */
export const SIDEBAR_STORAGE_KEY = "keyescrow-sidebar";
export const STAGE_ROUTES: readonly string[] = ["/demo", "/how-it-works"];

export type SidebarState = "expanded" | "collapsed";

/** Self-contained: it is stringified into the inline <head> script. */
function initialSidebar(key: string, stages: readonly string[], pathname: string): SidebarState {
  const onStage = stages.some((s) => pathname === s || pathname.startsWith(s + "/"));
  if (onStage) return "collapsed";
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(key);
  } catch {}
  return stored === "collapsed" ? "collapsed" : "expanded";
}

export const SIDEBAR_INIT_SCRIPT =
  `document.documentElement.dataset.sidebar=(${initialSidebar.toString()})(${JSON.stringify(SIDEBAR_STORAGE_KEY)},${JSON.stringify(STAGE_ROUTES)},location.pathname)`;

const listeners = new Set<() => void>();

export function subscribeSidebar(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getSidebarSnapshot = (): SidebarState =>
  document.documentElement.dataset.sidebar === "collapsed" ? "collapsed" : "expanded";

function apply(state: SidebarState) {
  if (document.documentElement.dataset.sidebar === state) return;
  document.documentElement.dataset.sidebar = state;
  listeners.forEach((l) => l());
}

export const isStageRoute = (pathname: string) => STAGE_ROUTES.some((s) => pathname === s || pathname.startsWith(s + "/"));

/** The toggle button: remembered, except on a stage (there it lasts for the visit). */
export function setSidebar(state: SidebarState, pathname: string) {
  if (!isStageRoute(pathname)) {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, state);
    } catch {}
  }
  apply(state);
}

/** After a client-side navigation: the state a fresh load of `pathname` would get. */
export function syncSidebarToRoute(pathname: string) {
  apply(initialSidebar(SIDEBAR_STORAGE_KEY, STAGE_ROUTES, pathname));
}
