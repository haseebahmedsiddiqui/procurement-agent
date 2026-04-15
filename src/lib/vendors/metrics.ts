/**
 * In-memory per-vendor search metrics.
 *
 * Tracks success rate, average scrape time, cache hit rate, and error
 * breakdown for each vendor within the current server process. These
 * metrics are exposed via the /api/vendors/metrics endpoint and shown
 * on the Settings page.
 *
 * Not persisted — resets on server restart. For production, swap with
 * a time-series store (Prometheus, InfluxDB) or periodic DB snapshots.
 */

export interface VendorMetrics {
  totalSearches: number;
  successes: number;
  failures: number;
  cacheHits: number;
  dictionaryHits: number;
  totalDurationMs: number;
  errorCounts: Record<string, number>; // errorType -> count
}

const metricsStore = new Map<string, VendorMetrics>();

function getOrCreate(vendorSlug: string): VendorMetrics {
  let m = metricsStore.get(vendorSlug);
  if (!m) {
    m = {
      totalSearches: 0,
      successes: 0,
      failures: 0,
      cacheHits: 0,
      dictionaryHits: 0,
      totalDurationMs: 0,
      errorCounts: {},
    };
    metricsStore.set(vendorSlug, m);
  }
  return m;
}

export function recordSearch(
  vendorSlug: string,
  outcome: {
    success: boolean;
    source: string;
    durationMs: number;
    errorType?: string;
  }
): void {
  const m = getOrCreate(vendorSlug);
  m.totalSearches++;
  m.totalDurationMs += outcome.durationMs;

  if (outcome.success) {
    m.successes++;
  } else {
    m.failures++;
    if (outcome.errorType) {
      m.errorCounts[outcome.errorType] = (m.errorCounts[outcome.errorType] || 0) + 1;
    }
  }

  if (outcome.source === "cache") m.cacheHits++;
  if (outcome.source === "dictionary") m.dictionaryHits++;
}

export interface VendorMetricsSummary {
  totalSearches: number;
  successRate: number;
  avgDurationMs: number;
  cacheHitRate: number;
  dictionaryHitRate: number;
  errorCounts: Record<string, number>;
}

export function getVendorMetrics(vendorSlug: string): VendorMetricsSummary | null {
  const m = metricsStore.get(vendorSlug);
  if (!m || m.totalSearches === 0) return null;
  return {
    totalSearches: m.totalSearches,
    successRate: m.successes / m.totalSearches,
    avgDurationMs: Math.round(m.totalDurationMs / m.totalSearches),
    cacheHitRate: m.cacheHits / m.totalSearches,
    dictionaryHitRate: m.dictionaryHits / m.totalSearches,
    errorCounts: { ...m.errorCounts },
  };
}

export function getAllVendorMetrics(): Record<string, VendorMetricsSummary> {
  const result: Record<string, VendorMetricsSummary> = {};
  for (const [slug] of metricsStore) {
    const summary = getVendorMetrics(slug);
    if (summary) result[slug] = summary;
  }
  return result;
}

export function resetVendorMetrics(vendorSlug?: string): void {
  if (vendorSlug) {
    metricsStore.delete(vendorSlug);
  } else {
    metricsStore.clear();
  }
}
