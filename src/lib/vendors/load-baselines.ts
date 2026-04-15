/**
 * Per-vendor load baselines — expected scrape timings.
 *
 * These are used to flag unexpectedly slow responses (potential degradation)
 * and to report perf metrics against known good baselines. Values are in
 * milliseconds and represent typical p90 times observed during development.
 *
 * A scrape that exceeds 2x the baseline logs a warning.
 */

export interface LoadBaseline {
  /** Expected p90 HTTP fetch duration (ms). */
  httpP90Ms: number;
  /** Expected p90 Playwright fetch duration (ms). */
  playwrightP90Ms: number;
  /** Expected p90 total search (fetch + LLM extraction) duration (ms). */
  totalSearchP90Ms: number;
}

const BASELINES: Record<string, LoadBaseline> = {
  amazon: {
    httpP90Ms: 3000,
    playwrightP90Ms: 8000,
    totalSearchP90Ms: 12000,
  },
  staples: {
    httpP90Ms: 2500,
    playwrightP90Ms: 6000,
    totalSearchP90Ms: 10000,
  },
  "office-depot": {
    httpP90Ms: 2000,
    playwrightP90Ms: 5000,
    totalSearchP90Ms: 9000,
  },
  "office-basics": {
    httpP90Ms: 2000,
    playwrightP90Ms: 6000,
    totalSearchP90Ms: 10000,
  },
  grainger: {
    httpP90Ms: 2500,
    playwrightP90Ms: 7000,
    totalSearchP90Ms: 11000,
  },
  mcmaster: {
    httpP90Ms: 4000, // McMaster often requires Playwright
    playwrightP90Ms: 8000,
    totalSearchP90Ms: 13000,
  },
  webstaurant: {
    httpP90Ms: 2000,
    playwrightP90Ms: 5000,
    totalSearchP90Ms: 9000,
  },
  equippers: {
    httpP90Ms: 2000,
    playwrightP90Ms: 5000,
    totalSearchP90Ms: 9000,
  },
};

/** Default baseline for custom/unknown vendors. */
const DEFAULT_BASELINE: LoadBaseline = {
  httpP90Ms: 3000,
  playwrightP90Ms: 8000,
  totalSearchP90Ms: 12000,
};

export function getBaseline(vendorSlug: string): LoadBaseline {
  return BASELINES[vendorSlug] ?? DEFAULT_BASELINE;
}

/**
 * Check if a duration exceeds 2x the baseline for that phase.
 * Returns a warning string if slow, or null if within normal range.
 */
export function checkSlowness(
  vendorSlug: string,
  phase: "http" | "playwright" | "total",
  durationMs: number
): string | null {
  const baseline = getBaseline(vendorSlug);
  const threshold =
    phase === "http"
      ? baseline.httpP90Ms * 2
      : phase === "playwright"
        ? baseline.playwrightP90Ms * 2
        : baseline.totalSearchP90Ms * 2;

  if (durationMs > threshold) {
    return `${vendorSlug} ${phase} took ${durationMs}ms (baseline: ${threshold / 2}ms, threshold: ${threshold}ms)`;
  }
  return null;
}
