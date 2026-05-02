import { NextRequest } from "next/server";
import {
  searchVendors,
  type ItemSearchRequest,
  type VendorItemResult,
} from "@/lib/vendors/search-engine";
import { logEventStorage } from "@/lib/logger";

/**
 * Streaming NDJSON search endpoint.
 *
 * Each line of the response body is a JSON object with one of these shapes:
 *   { type: "log",       level, message, data?, ts }
 *   { type: "progress",  completed, total, currentVendor?, currentItem?, ts }
 *   { type: "result",    itemIndex, vendorSlug, ...vendorResult, ts }
 *   { type: "summary",   totalItems, totalVendors, totalResults, totalFailures, ts }
 *   { type: "done",      ts }
 *   { type: "cancelled", ts }
 *   { type: "error",     error, ts }
 *
 * The route installs a per-request log emitter via AsyncLocalStorage so all
 * `logger.info(...)` calls inside searchVendors stream out as { type: "log" }
 * events without us needing to thread a callback through every adapter.
 *
 * Cancellation: client aborts the fetch → request.signal fires →
 * searchVendors checks the signal between items and stops cleanly.
 */
export async function POST(request: NextRequest) {
  const { items, vendorSlugs } = (await request.json()) as {
    items: ItemSearchRequest[];
    vendorSlugs: string[];
  };

  if (!items?.length || !vendorSlugs?.length) {
    return new Response(
      JSON.stringify({ error: "items and vendorSlugs are required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      const emit = (event: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // controller may already be closed (client disconnect)
        }
      };

      try {
        await logEventStorage.run(
          {
            emit: (logEvent) => emit({ type: "log", ...logEvent }),
          },
          async () => {
            const allResults: VendorItemResult[] = [];

            await searchVendors(items, vendorSlugs, {
              signal: request.signal,
              onProgress: (p) =>
                emit({ type: "progress", ts: Date.now(), ...p }),
              onResult: (r) => {
                allResults.push(r);
                emit({
                  type: "result",
                  ts: Date.now(),
                  itemIndex: r.itemIndex,
                  vendorSlug: r.vendorSlug,
                  productName: r.outcome.result?.productName,
                  productId: r.outcome.result?.productId,
                  productUrl: r.outcome.result?.productUrl,
                  price: r.outcome.result?.price,
                  currency: r.outcome.result?.currency,
                  inStock: r.outcome.result?.inStock,
                  deliveryEstimate: r.outcome.result?.deliveryEstimate,
                  reviewCount: r.outcome.result?.reviewCount,
                  starRating: r.outcome.result?.starRating,
                  source: r.outcome.source,
                  durationMs: r.outcome.durationMs,
                  error: r.outcome.error,
                  errorType: r.outcome.errorType,
                });
              },
            });

            const totalResults = allResults.filter((r) => r.outcome.result).length;
            const totalFailures = allResults.filter((r) => !r.outcome.result).length;

            emit({
              type: "summary",
              ts: Date.now(),
              totalItems: items.length,
              totalVendors: vendorSlugs.length,
              totalResults,
              totalFailures,
            });

            if (request.signal.aborted) {
              emit({ type: "cancelled", ts: Date.now() });
            } else {
              emit({ type: "done", ts: Date.now() });
            }
          }
        );
      } catch (err) {
        emit({
          type: "error",
          ts: Date.now(),
          error: err instanceof Error ? err.message : "Search failed",
        });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // ignore
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      // Disable proxy buffering so events flush as they arrive
      "X-Accel-Buffering": "no",
    },
  });
}
