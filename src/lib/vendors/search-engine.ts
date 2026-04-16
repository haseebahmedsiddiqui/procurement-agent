import { getAdapter, hasAdapter } from "./registry";
import type { SearchInput, SearchOutcome } from "./base-adapter";
import { getBreaker } from "./circuit-breaker";
import { vendorSearchSemaphore } from "./concurrency";
import { checkSlowness } from "./load-baselines";
import { recordSearch } from "./metrics";
import { connectDB } from "@/lib/db/connection";
import { Vendor } from "@/lib/db/models/Vendor";
import { logger } from "@/lib/logger";

export interface ItemSearchRequest {
  index: number;
  rfqDescription: string;
  normalizedName: string;
  impaCode?: string;
  quantity: number;
  unit: string;
  searchQueries: Record<string, string>; // vendorSlug -> query
  /**
   * Item's detected category (e.g. "stationery", "deck_engine", "galley_kitchen").
   * When present, the search engine only queries vendors that belong to this
   * category, so a stationery line doesn't get searched on amazon-deck.
   */
  category?: string;
}

export interface VendorItemResult {
  itemIndex: number;
  vendorSlug: string;
  outcome: SearchOutcome;
  confidence?: number;
  reasoning?: string;
}

export interface SearchProgress {
  totalItems: number;
  totalVendors: number;
  completed: number;
  total: number;
  currentVendor?: string;
  currentItem?: string;
}

export interface SearchVendorsOptions {
  signal?: AbortSignal;
  onProgress?: (progress: SearchProgress) => void;
  /**
   * Called as soon as each item-vendor pair completes, so the UI can
   * progressively populate the results table while the search is still
   * running. Independent of the final return value.
   */
  onResult?: (result: VendorItemResult) => void;
}

/**
 * Search all selected vendors for a list of items.
 *
 * Vendors run in parallel (rate limits are per-vendor, not shared).
 * Within a single vendor, items run sequentially so the per-vendor rate
 * limiter in BaseVendorAdapter is honored.
 *
 * If one vendor fails, others complete independently — Promise.allSettled
 * isolates failures.
 *
 * Cancellation: checked between items. An in-flight item completes before
 * the loop exits, but no new items start once `signal.aborted` is true.
 */
export async function searchVendors(
  items: ItemSearchRequest[],
  vendorSlugs: string[],
  options: SearchVendorsOptions = {}
): Promise<VendorItemResult[]> {
  const { signal, onProgress, onResult } = options;
  let completed = 0;

  // Filter to vendors that have adapters
  const activeVendors = vendorSlugs.filter((slug) => {
    if (!hasAdapter(slug)) {
      logger.warn({ vendor: slug }, "No adapter available, skipping");
      return false;
    }
    return true;
  });

  // Look up each vendor's category so we can skip (item, vendor) pairs where
  // the item's detected category doesn't match the vendor's category. This is
  // why the seed has amazon / amazon-deck / amazon-galley as separate rows —
  // so a stationery line never gets searched on amazon-deck with deck phrasing.
  const vendorCategoryMap: Record<string, string | undefined> = {};
  try {
    await connectDB();
    const vendorDocs = await Vendor.find({ slug: { $in: activeVendors } })
      .select("slug category")
      .lean();
    for (const v of vendorDocs) {
      vendorCategoryMap[v.slug as string] = v.category as string | undefined;
    }
  } catch (err) {
    logger.warn({ error: err }, "Could not load vendor categories — category filter disabled");
  }

  const itemsForVendor = (vendorSlug: string): ItemSearchRequest[] => {
    const vendorCategory = vendorCategoryMap[vendorSlug];
    // If either the vendor or the item has no category info, fall back to the
    // old "run everything" behavior so we never silently drop a search.
    if (!vendorCategory) return items;
    return items.filter(
      (it) => !it.category || it.category === vendorCategory
    );
  };

  // Total reflects only the pairs that will actually run
  const total = activeVendors.reduce(
    (sum, slug) => sum + itemsForVendor(slug).length,
    0
  );

  // Run each vendor's filtered item-list in parallel, limited by semaphore
  const vendorRuns = activeVendors.map(async (vendorSlug) => {
    await vendorSearchSemaphore.acquire();
    try {
      const filteredItems = itemsForVendor(vendorSlug);
      const skipped = items.length - filteredItems.length;
      if (skipped > 0) {
        logger.info(
          { vendor: vendorSlug, vendorCategory: vendorCategoryMap[vendorSlug], skipped, willSearch: filteredItems.length },
          "Skipping items in other categories"
        );
      }
      return await runVendorSearch(vendorSlug, filteredItems, activeVendors.length, total, signal, onProgress, onResult, () => completed++);
    } finally {
      vendorSearchSemaphore.release();
    }
  });

  async function runVendorSearch(
    vendorSlug: string,
    items: ItemSearchRequest[],
    vendorCount: number,
    totalCount: number,
    signal: AbortSignal | undefined,
    onProgress: ((p: SearchProgress) => void) | undefined,
    onResult: ((r: VendorItemResult) => void) | undefined,
    incrementCompleted: () => void,
  ): Promise<VendorItemResult[]> {
    const vendorResults: VendorItemResult[] = [];
    let adapter;
    try {
      adapter = await getAdapter(vendorSlug);
    } catch (err) {
      logger.error(
        { vendor: vendorSlug, error: err },
        "Failed to load adapter, skipping vendor"
      );
      return vendorResults;
    }

    const breaker = getBreaker(vendorSlug);

    for (const item of items) {
      if (signal?.aborted) {
        logger.warn(
          { vendor: vendorSlug, completed: vendorResults.length },
          "Search cancelled — stopping vendor loop"
        );
        break;
      }

      // Circuit breaker: skip if vendor is in open state
      if (!breaker.canRequest()) {
        logger.warn({ vendor: vendorSlug }, "Circuit breaker open — skipping item");
        const input: SearchInput = {
          rfqDescription: item.rfqDescription,
          normalizedName: item.normalizedName,
          searchQuery: item.searchQueries[vendorSlug] || item.normalizedName,
          impaCode: item.impaCode,
          quantity: item.quantity,
          unit: item.unit,
        };
        const r: VendorItemResult = {
          itemIndex: item.index,
          vendorSlug,
          outcome: {
            input,
            result: null,
            source: "http",
            durationMs: 0,
            error: "Vendor paused (circuit breaker open after repeated failures)",
            errorType: "error",
          },
        };
        vendorResults.push(r);
        onResult?.(r);
        incrementCompleted();
        continue;
      }

      const query = item.searchQueries[vendorSlug] || item.normalizedName;

      onProgress?.({
        totalItems: items.length,
        totalVendors: vendorCount,
        completed: 0, // progress is approximate
        total: totalCount,
        currentVendor: vendorSlug,
        currentItem: item.rfqDescription,
      });

      const input: SearchInput = {
        rfqDescription: item.rfqDescription,
        normalizedName: item.normalizedName,
        searchQuery: query,
        impaCode: item.impaCode,
        quantity: item.quantity,
        unit: item.unit,
      };

      try {
        const outcome = await adapter.search(input);
        const r: VendorItemResult = {
          itemIndex: item.index,
          vendorSlug,
          outcome,
        };
        vendorResults.push(r);
        onResult?.(r);

        // Update circuit breaker + metrics based on outcome
        recordSearch(vendorSlug, {
          success: !!outcome.result,
          source: outcome.source,
          durationMs: outcome.durationMs,
          errorType: outcome.errorType,
        });
        if (outcome.result) {
          breaker.recordSuccess();
        } else if (outcome.errorType && outcome.errorType !== "no_results") {
          breaker.recordFailure();
        }

        if (outcome.result && outcome.result.productName) {
          logger.info(
            {
              vendor: vendorSlug,
              product: outcome.result.productName,
              price: outcome.result.price,
              source: outcome.source,
              durationMs: outcome.durationMs,
            },
            "Match found"
          );
        }

        // Warn if scrape was unexpectedly slow vs baseline
        const slow = checkSlowness(vendorSlug, "total", outcome.durationMs);
        if (slow) logger.warn({ vendor: vendorSlug, durationMs: outcome.durationMs }, slow);
      } catch (err) {
        breaker.recordFailure();
        logger.error(
          { vendor: vendorSlug, item: item.rfqDescription, error: err },
          "Item search threw"
        );
        const r: VendorItemResult = {
          itemIndex: item.index,
          vendorSlug,
          outcome: {
            input,
            result: null,
            source: "http",
            durationMs: 0,
            error: err instanceof Error ? err.message : "Unknown error",
          },
        };
        vendorResults.push(r);
        onResult?.(r);
      }

      incrementCompleted();
    }

    return vendorResults;
  }

  const settled = await Promise.allSettled(vendorRuns);
  const results: VendorItemResult[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled") {
      results.push(...s.value);
    } else {
      logger.error({ error: s.reason }, "Vendor run rejected");
    }
  }

  logger.info(
    {
      items: items.length,
      vendors: activeVendors.length,
      results: results.filter((r) => r.outcome.result).length,
      failures: results.filter((r) => !r.outcome.result).length,
    },
    "Vendor search complete"
  );

  return results;
}

