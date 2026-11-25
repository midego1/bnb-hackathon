/** Loose env map so callers (and tests) can pass plain objects instead of process.env. */
export type Env = Record<string, string | undefined>;
