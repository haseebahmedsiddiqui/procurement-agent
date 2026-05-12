"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Upload,
  Store,
  Sparkles,
  ClipboardCheck,
  Search,
  BarChart3,
  Check,
  RotateCcw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileUpload, type UploadResult } from "@/components/rfq/file-upload";
import { StorePicker } from "@/components/rfq/store-picker";
import { ItemsTable, type ItemOverride } from "@/components/rfq/items-table";
import { SearchResults } from "@/components/rfq/search-results";
import { SearchLog, type LogLine } from "@/components/rfq/search-log";
import { cn } from "@/lib/utils";
import type { NormalizedItem } from "@/lib/ai/item-normalizer";

type Step = "upload" | "pick-stores" | "normalizing" | "review" | "searching" | "results";

const STEPS: { key: Step; label: string; icon: typeof Upload }[] = [
  { key: "upload", label: "Upload", icon: Upload },
  { key: "pick-stores", label: "Stores", icon: Store },
  { key: "normalizing", label: "Normalize", icon: Sparkles },
  { key: "review", label: "Review", icon: ClipboardCheck },
  { key: "searching", label: "Search", icon: Search },
  { key: "results", label: "Results", icon: BarChart3 },
];

interface VendorData {
  slug: string;
  name: string;
  category: string;
  authRequired: boolean;
  preferredStrategy: string;
}

interface CategoryData {
  slug: string;
  name: string;
  icon: string;
  defaultVendors: string[];
}

function StepIndicator({ currentStep }: { currentStep: Step }) {
  const currentIdx = STEPS.findIndex((s) => s.key === currentStep);

  return (
    <div className="flex items-center rounded-xl border border-border/60 bg-card p-1.5 shadow-sm">
      {STEPS.map((s, i) => {
        const isComplete = i < currentIdx;
        const isCurrent = i === currentIdx;
        const Icon = isComplete ? Check : s.icon;

        return (
          <div key={s.key} className="flex items-center">
            {i > 0 && (
              <div className="relative h-px w-6 sm:w-10 bg-border mx-0.5">
                {i <= currentIdx && (
                  <div className="absolute inset-0 bg-primary/40 animate-stepper-fill" />
                )}
              </div>
            )}
            <div
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-1.5 transition-all duration-300",
                isCurrent && "bg-primary/[0.08]",
              )}
            >
              <div
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-300",
                  isComplete && "bg-primary text-primary-foreground shadow-sm shadow-primary/25",
                  isCurrent && "bg-primary/15 text-primary",
                  !isComplete && !isCurrent && "bg-muted text-muted-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </div>
              <span
                className={cn(
                  "hidden sm:block text-xs font-medium transition-colors",
                  isCurrent && "text-primary",
                  isComplete && "text-foreground",
                  !isComplete && !isCurrent && "text-muted-foreground"
                )}
              >
                {s.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function HomePage() {
  const [step, setStep] = useState<Step>("upload");
  const [uploadData, setUploadData] = useState<UploadResult | null>(null);
  const [vendors, setVendors] = useState<VendorData[]>([]);
  const [categories, setCategories] = useState<CategoryData[]>([]);
  const [selectedVendors, setSelectedVendors] = useState<Record<string, string[]>>({});
  const [normalizedItems, setNormalizedItems] = useState<NormalizedItem[]>([]);
  const [normalizeError, setNormalizeError] = useState<string | null>(null);
  const [itemOverrides, setItemOverrides] = useState<Record<number, ItemOverride>>({});
  const [searchQueryOverrides, setSearchQueryOverrides] = useState<Record<string, string>>({});
  const [searchResults, setSearchResults] = useState<Record<number, Array<{
    vendorSlug: string; productName?: string; productId?: string;
    productUrl?: string; price?: number; currency?: string;
    inStock?: boolean; deliveryEstimate?: string; source: string;
    durationMs: number; error?: string; errorType?: string;
  }>>>({});
  const [internalMatches, setInternalMatches] = useState<Record<number, {
    primary: {
      id: string;
      itemCode: string;
      description: string;
      unitOfMeasure: string;
      rank: "A"|"B"|"C"|"D"|"E"|null;
      derivedUnitCost: number | null;
      isActive: boolean;
      pyrUnits: number;
      pyrSalesUsd: number;
    } | null;
    confidence: number;
    reasoning: string;
  }>>({});
  const [searchSummary, setSearchSummary] = useState({ totalItems: 0, totalVendors: 0, totalResults: 0, totalFailures: 0 });
  const [searchLogs, setSearchLogs] = useState<LogLine[]>([]);
  const [searchProgress, setSearchProgress] = useState<{
    completed: number;
    total: number;
    currentVendor?: string;
    currentItem?: string;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prevStepRef = useRef<Step>("upload");

  // Server-side searchRun id for stream-save. Set on first successful save,
  // reused for all subsequent saves in the same run so we update in place
  // instead of pushing a new run per save.
  const currentRunIdRef = useRef<string | null>(null);

  // Mirror searchResults in a ref so the stream-save debouncer can read
  // the freshest state without re-binding on every render.
  const searchResultsRef = useRef(searchResults);
  searchResultsRef.current = searchResults;
  const summaryRef = useRef(searchSummary);
  summaryRef.current = searchSummary;
  const selectedVendorsRef = useRef(selectedVendors);
  selectedVendorsRef.current = selectedVendors;
  const internalMatchesRef = useRef(internalMatches);
  internalMatchesRef.current = internalMatches;

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistInFlightRef = useRef(false);

  const handleUploadComplete = useCallback(async (data: UploadResult) => {
    setUploadData(data);

    try {
      const res = await fetch("/api/vendors");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const vendorData = await res.json();
      setVendors(vendorData.vendors);
      setCategories(vendorData.categories);
    } catch (err) {
      toast.error(
        `Couldn't load vendors: ${err instanceof Error ? err.message : "unknown error"}`
      );
    }

    toast.success(`Loaded ${data.totalItems} items from ${data.filename}`);

    if (data.warnings && data.warnings.length > 0) {
      const shown = data.warnings.slice(0, 3);
      for (const w of shown) toast.warning(w);
      if (data.warnings.length > shown.length) {
        toast.warning(
          `…and ${data.warnings.length - shown.length} more parse warning(s)`
        );
      }
    }

    setStep("pick-stores");
  }, []);

  // Load from history. `?rfq=ID` alone behaves like before (jump to store-picker
  // for a fresh run). `?rfq=ID&mode=edit` restores saved results and opens the
  // results view directly. `?rfq=ID&mode=resume` does the same but immediately
  // re-runs the (item, vendor) pairs that have no result yet.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const rfqId = params.get("rfq");
    if (!rfqId) return;
    const mode = params.get("mode"); // null | "edit" | "resume"

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/history/${rfqId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;

        const items = (data.items || []) as Array<{
          lineNumber: number;
          description: string;
          impaCode?: string;
          quantity: number;
          unit: string;
          notes?: string;
        }>;

        const category =
          (data.detectedCategory as
            | "stationery"
            | "deck_engine"
            | "galley_kitchen") || "stationery";

        const reconstructed: UploadResult = {
          rfqId: data.id,
          filename: data.filename,
          format: "rerun",
          totalItems: items.length,
          items,
          warnings: [],
          detection: {
            primaryCategory: category,
            isMixed: false,
            overallConfidence: data.categoryConfidence || 0,
            groups: [
              {
                category,
                confidence: data.categoryConfidence || 0,
                itemIndices: items.map((_, i) => i),
                reasoning: "Loaded from history",
              },
            ],
          },
        };

        await handleUploadComplete(reconstructed);

        // For edit/resume: rehydrate the saved run into the results state
        // and restore the vendor selection so refresh + resume work.
        if (mode === "edit" || mode === "resume") {
          const runs = (data.searchRuns ?? []) as Array<{
            id: string;
            status?: string;
            vendorSlugs?: string[];
            totalResults?: number;
            totalFailures?: number;
            items?: Array<{
              itemIndex: number;
              results: Array<Record<string, unknown>>;
              internalMatch?: {
                inventoryItemId?: string;
                itemCode?: string;
                description?: string;
                unitOfMeasure?: string;
                rank?: "A" | "B" | "C" | "D" | "E" | null;
                derivedUnitCost?: number | null;
                isActive?: boolean;
                pyrUnits?: number;
                pyrSalesUsd?: number;
                confidence?: number;
                reasoning?: string;
              } | null;
            }>;
          }>;
          const latest = runs[runs.length - 1];
          if (latest) {
            currentRunIdRef.current = latest.id;
            // Rebuild searchResults + internalMatches keyed by itemIndex
            const rebuilt: Record<number, Array<Record<string, unknown>>> = {};
            const rebuiltInternal: Record<number, {
              primary: NonNullable<typeof internalMatches[number]["primary"]> | null;
              confidence: number;
              reasoning: string;
            }> = {};
            for (const it of latest.items ?? []) {
              rebuilt[it.itemIndex] = it.results.map((r) => ({
                ...r,
                source: r.source ?? "history",
                durationMs: 0,
              }));
              if (it.internalMatch?.inventoryItemId) {
                const im = it.internalMatch;
                rebuiltInternal[it.itemIndex] = {
                  primary: {
                    id: im.inventoryItemId!,
                    itemCode: im.itemCode ?? "",
                    description: im.description ?? "",
                    unitOfMeasure: im.unitOfMeasure ?? "",
                    rank: im.rank ?? null,
                    derivedUnitCost: im.derivedUnitCost ?? null,
                    isActive: !!im.isActive,
                    pyrUnits: im.pyrUnits ?? 0,
                    pyrSalesUsd: im.pyrSalesUsd ?? 0,
                  },
                  confidence: im.confidence ?? 0,
                  reasoning: im.reasoning ?? "",
                };
              }
            }
            setSearchResults(rebuilt as typeof searchResults);
            setInternalMatches(rebuiltInternal);
            setSearchSummary({
              totalItems: items.length,
              totalVendors: (latest.vendorSlugs ?? []).length,
              totalResults: latest.totalResults ?? 0,
              totalFailures: latest.totalFailures ?? 0,
            });
            // Restore vendor selection grouped by category so resume/refresh work
            const selection: Record<string, string[]> = {};
            selection[category] = latest.vendorSlugs ?? [];
            setSelectedVendors(selection);
            setStep("results");

            // Auto-run resume if requested and there's incomplete work
            if (mode === "resume") {
              const allSlugs = latest.vendorSlugs ?? [];
              const restrict: Record<number, string[]> = {};
              items.forEach((_, idx) => {
                const have = new Set(
                  (rebuilt[idx] || []).map(
                    (r) => (r as { vendorSlug?: string }).vendorSlug
                  )
                );
                const missing = allSlugs.filter((s) => !have.has(s));
                if (missing.length > 0) restrict[idx] = missing;
              });
              if (Object.keys(restrict).length > 0) {
                // Defer one tick so state updates settle before the search starts
                setTimeout(() => handleSearch({ restrict }), 50);
              }
            }
          }
        }

        const url = new URL(window.location.href);
        url.searchParams.delete("rfq");
        url.searchParams.delete("mode");
        window.history.replaceState({}, "", url.toString());
      } catch {
        // Silent fail — user can still upload normally
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleUploadComplete]);

  const handleStoreConfirm = useCallback(
    async (selection: Record<string, string[]>) => {
      if (!uploadData) return;

      setSelectedVendors(selection);
      setStep("normalizing");
      setNormalizeError(null);

      const allSlugs = Object.values(selection).flat();

      try {
        const res = await fetch("/api/normalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: uploadData.items,
            vendorSlugs: allSlugs,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Normalization failed");
        }

        setNormalizedItems(data.normalized);
        setStep("review");
      } catch (err) {
        setNormalizeError(
          err instanceof Error ? err.message : "Normalization failed"
        );
        setStep("review");
      }
    },
    [uploadData]
  );

  const appendLog = useCallback((line: LogLine) => {
    setSearchLogs((prev) => {
      if (prev.length >= 500) return [...prev.slice(-499), line];
      return [...prev, line];
    });
  }, []);

  /**
   * Push the current in-memory results to the server. Reuses currentRunId so
   * each call updates the same searchRun in place; the very first call
   * creates the run and learns the id from the response.
   *
   * `status` controls what state the server records — "running" keeps the
   * run open for further appends; "completed"/"cancelled" close it out.
   */
  const persistResults = useCallback(
    async (status: "running" | "completed" | "cancelled" | "failed") => {
      const rfqId = uploadData?.rfqId;
      if (!rfqId) return;
      if (persistInFlightRef.current) return; // a save is already mid-flight
      persistInFlightRef.current = true;
      try {
        const body = {
          rfqId,
          runId: currentRunIdRef.current ?? undefined,
          vendorSlugs: Object.values(selectedVendorsRef.current).flat(),
          results: searchResultsRef.current,
          internalMatches: internalMatchesRef.current,
          summary: {
            totalResults: summaryRef.current.totalResults,
            totalFailures: summaryRef.current.totalFailures,
          },
          status,
        };
        const res = await fetch("/api/history/save-results", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.runId && currentRunIdRef.current !== data.runId) {
            currentRunIdRef.current = data.runId;
          }
        }
      } catch {
        // Non-fatal: next debounced flush will retry
      } finally {
        persistInFlightRef.current = false;
      }
    },
    [uploadData?.rfqId]
  );

  /** Debounced 1.5s — collapses bursts of result events into one save. */
  const schedulePersist = useCallback(() => {
    if (persistTimerRef.current) return; // already scheduled
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      persistResults("running");
    }, 1500);
  }, [persistResults]);

  const handleSearchEvent = useCallback(
    (event: Record<string, unknown>) => {
      const type = event.type as string;

      if (type === "log") {
        appendLog({
          level: (event.level as LogLine["level"]) || "info",
          message: (event.message as string) || "",
          data: event.data as Record<string, unknown> | undefined,
          ts: (event.ts as number) || Date.now(),
        });
      } else if (type === "progress") {
        setSearchProgress({
          completed: event.completed as number,
          total: event.total as number,
          currentVendor: event.currentVendor as string | undefined,
          currentItem: event.currentItem as string | undefined,
        });
      } else if (type === "result") {
        const itemIndex = event.itemIndex as number;
        const vendorResult = {
          vendorSlug: event.vendorSlug as string,
          productName: event.productName as string | undefined,
          productId: event.productId as string | undefined,
          productUrl: event.productUrl as string | undefined,
          price: event.price as number | undefined,
          currency: event.currency as string | undefined,
          inStock: event.inStock as boolean | undefined,
          deliveryEstimate: event.deliveryEstimate as string | undefined,
          source: event.source as string,
          durationMs: event.durationMs as number,
          error: event.error as string | undefined,
          errorType: event.errorType as string | undefined,
        };
        setSearchResults((prev) => {
          const next = { ...prev };
          const existing = next[itemIndex] || [];
          const filtered = existing.filter(
            (r) => r.vendorSlug !== vendorResult.vendorSlug
          );
          next[itemIndex] = [...filtered, vendorResult];
          return next;
        });
        // Stream-save every new result so a tab-close mid-search doesn't
        // lose anything that already finished.
        schedulePersist();
      } else if (type === "internal_match") {
        const itemIndex = event.itemIndex as number;
        setInternalMatches((prev) => ({
          ...prev,
          [itemIndex]: {
            primary: event.primary as typeof prev[number]["primary"],
            confidence: event.confidence as number,
            reasoning: event.reasoning as string,
          },
        }));
      } else if (type === "summary") {
        setSearchSummary({
          totalItems: event.totalItems as number,
          totalVendors: event.totalVendors as number,
          totalResults: event.totalResults as number,
          totalFailures: event.totalFailures as number,
        });
      } else if (type === "done") {
        // Cancel any pending debounced save and flush a final completed save
        if (persistTimerRef.current) {
          clearTimeout(persistTimerRef.current);
          persistTimerRef.current = null;
        }
        persistResults("completed");
        setStep("results");
        toast.success("Search complete");
      } else if (type === "cancelled") {
        if (persistTimerRef.current) {
          clearTimeout(persistTimerRef.current);
          persistTimerRef.current = null;
        }
        persistResults("cancelled");
        setStep("results");
        toast.warning("Search cancelled");
      } else if (type === "error") {
        appendLog({
          level: "error",
          message: (event.error as string) || "Search failed",
          ts: Date.now(),
        });
        toast.error((event.error as string) || "Search failed");
      }
    },
    [appendLog, schedulePersist, persistResults]
  );

  /**
   * Run vendor searches.
   *
   * Default mode (no `restrict` arg): full search across every selected
   * vendor for every item. Clears prior results and starts a fresh run.
   *
   * Restricted mode: pass a `restrict` map of `{ itemIndex: [vendorSlug...] }`
   * specifying exactly which (item, vendor) pairs to search. Existing
   * results are preserved and only the named pairs are re-fetched. Used by:
   *   - resume (run only missing pairs after a crash/cancel)
   *   - per-vendor refresh (re-scrape a single vendor's failed cells)
   */
  const handleSearch = useCallback(async (opts?: {
    restrict?: Record<number, string[]>;
  }) => {
    if (!uploadData) return;

    const restrict = opts?.restrict;
    const isFullRun = !restrict;

    setStep("searching");
    setSearchLogs([]);
    if (isFullRun) {
      setSearchResults({});
      setInternalMatches({});
      currentRunIdRef.current = null;
    }
    setSearchProgress(null);
    setSearchSummary({ totalItems: 0, totalVendors: 0, totalResults: 0, totalFailures: 0 });

    const allSlugs = isFullRun
      ? Object.values(selectedVendors).flat()
      : Array.from(new Set(Object.values(restrict).flat()));

    // Flatten the category groups into a per-item category lookup so each
    // searchItem carries its category. The search engine uses this to skip
    // (item, vendor) pairs where categories don't match (e.g. a stationery
    // line never runs on amazon-deck).
    const itemCategoryByIndex: Record<number, string> = Object.fromEntries(
      uploadData.detection.groups.flatMap((g) =>
        g.itemIndices.map((i) => [i, g.category] as const)
      )
    );

    const searchItems = uploadData.items
      .map((item, idx) => {
        const norm = normalizedItems.find((n) => n.index === idx);
        const override = itemOverrides[idx];
        const overrideQuery = override?.partNumber?.trim()
          ? `${override.brand?.trim() ?? ""} ${override.partNumber.trim()}`.trim()
          : null;

        const baseQueries = overrideQuery
          ? Object.fromEntries(allSlugs.map((s) => [s, overrideQuery]))
          : norm?.searchQueries ||
            Object.fromEntries(allSlugs.map((s) => [s, item.description]));

        const searchQueries = { ...baseQueries };
        for (const slug of allSlugs) {
          const edited = searchQueryOverrides[`${idx}::${slug}`];
          if (edited) searchQueries[slug] = edited;
        }

        const restrictForItem = restrict?.[idx];

        return {
          index: idx,
          rfqDescription: item.description,
          normalizedName: overrideQuery || norm?.normalizedName || item.description,
          impaCode: item.impaCode,
          quantity: item.quantity,
          unit: item.unit,
          searchQueries,
          category: itemCategoryByIndex[idx],
          restrictVendors: restrictForItem,
        };
      })
      // In restricted mode, drop items with no pairs to run so the server
      // doesn't waste time on them.
      .filter((si) => !restrict || (si.restrictVendors && si.restrictVendors.length > 0));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: searchItems, vendorSlugs: allSlugs }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`Search failed to start (HTTP ${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            handleSearchEvent(JSON.parse(trimmed));
          } catch {
            // Skip malformed line
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        appendLog({
          level: "warn",
          message: "Search cancelled by user",
          ts: Date.now(),
        });
        setStep("results");
      } else {
        console.error("Search error:", err);
        appendLog({
          level: "error",
          message: err instanceof Error ? err.message : "Search failed",
          ts: Date.now(),
        });
        setStep("review");
      }
    } finally {
      abortRef.current = null;
    }
  }, [uploadData, selectedVendors, normalizedItems, itemOverrides, searchQueryOverrides, handleSearchEvent, appendLog]);

  const handleCancelSearch = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /**
   * Re-run only (item, vendor) pairs that have no result yet — used when
   * coming back to a search that was interrupted by tab close, crash, or
   * explicit cancel. Existing results are preserved.
   */
  const handleResume = useCallback(() => {
    if (!uploadData) return;
    const allSlugs = Object.values(selectedVendors).flat();
    const itemCategoryByIndex: Record<number, string> = Object.fromEntries(
      uploadData.detection.groups.flatMap((g) =>
        g.itemIndices.map((i) => [i, g.category] as const)
      )
    );
    const restrict: Record<number, string[]> = {};
    uploadData.items.forEach((_, idx) => {
      const existing = searchResultsRef.current[idx] || [];
      const haveVendors = new Set(existing.map((r) => r.vendorSlug));
      // Honor category filter — don't try to resume vendors that wouldn't
      // run for this item in the first place.
      const itemCategory = itemCategoryByIndex[idx];
      const missing = allSlugs.filter((slug) => {
        if (haveVendors.has(slug)) return false;
        // Without per-vendor category here we err on the side of including;
        // the search engine's own category filter will skip mismatches.
        return true;
      });
      void itemCategory;
      if (missing.length > 0) restrict[idx] = missing;
    });
    if (Object.keys(restrict).length === 0) {
      toast.info("Nothing to resume — every item has results");
      return;
    }
    handleSearch({ restrict });
  }, [uploadData, selectedVendors, handleSearch]);

  /**
   * Re-scrape one vendor across all items where it currently has no good
   * result (no productName, or an error). Useful when Amazon CAPTCHA'd
   * last time or a vendor was flaky during a previous run.
   */
  const handleVendorRefresh = useCallback(
    (vendorSlug: string) => {
      if (!uploadData) return;
      const restrict: Record<number, string[]> = {};
      uploadData.items.forEach((_, idx) => {
        const existing = searchResultsRef.current[idx] || [];
        const vr = existing.find((r) => r.vendorSlug === vendorSlug);
        const failed = !vr || !vr.productName || !!vr.error;
        if (failed) restrict[idx] = [vendorSlug];
      });
      if (Object.keys(restrict).length === 0) {
        toast.info(`No failed cells to re-run for ${vendorSlug}`);
        return;
      }
      handleSearch({ restrict });
    },
    [uploadData, handleSearch]
  );

  const handleOverrideChange = useCallback(
    (index: number, field: "brand" | "partNumber", value: string) => {
      setItemOverrides((prev) => {
        const trimmed = value.trim();
        const current = prev[index] ?? {};
        const next: ItemOverride = { ...current, [field]: trimmed || undefined };
        // Drop empty entries so the cell visual state stays clean
        if (!next.brand && !next.partNumber) {
          const { [index]: _removed, ...rest } = prev;
          void _removed;
          return rest;
        }
        return { ...prev, [index]: next };
      });
    },
    []
  );

  const handleSearchQueryOverride = useCallback(
    (itemIndex: number, vendorSlug: string, value: string) => {
      const key = `${itemIndex}::${vendorSlug}`;
      setSearchQueryOverrides((prev) => {
        const trimmed = value.trim();
        if (!trimmed) {
          const { [key]: _removed, ...rest } = prev;
          void _removed;
          return rest;
        }
        return { ...prev, [key]: trimmed };
      });
    },
    []
  );

  const handleReset = () => {
    abortRef.current?.abort();
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    setStep("upload");
    setUploadData(null);
    setNormalizedItems([]);
    setNormalizeError(null);
    setItemOverrides({});
    setSearchQueryOverrides({});
    setSearchResults({});
    setInternalMatches({});
    setSearchLogs([]);
    setSearchProgress(null);
    currentRunIdRef.current = null;
  };

  // Stream-save handles persistence now; this effect just tracks step
  // transitions for any future hooks that need them.
  useEffect(() => {
    prevStepRef.current = step;
  }, [step]);

  const allSelectedSlugs = Object.values(selectedVendors).flat();

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Price Comparison</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload an RFQ to compare prices across maritime suppliers
          </p>
        </div>
        {step !== "upload" && (
          <Button variant="outline" size="sm" onClick={handleReset} className="gap-2 rounded-lg shadow-sm">
            <RotateCcw className="h-3.5 w-3.5" />
            Start Over
          </Button>
        )}
      </div>

      {/* Step indicator */}
      <StepIndicator currentStep={step} />

      {/* Step 1: Upload */}
      {step === "upload" && <FileUpload onUploadComplete={handleUploadComplete} />}

      {/* Step 2: Store Picker */}
      {step === "pick-stores" && uploadData && (
        <div className="space-y-5">
          {/* Upload summary */}
          <div className="flex items-center gap-3.5 rounded-xl border border-border/60 bg-card px-5 py-3.5 shadow-sm">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <Upload className="h-4.5 w-4.5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{uploadData.filename}</p>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="text-[10px] rounded-md">{uploadData.format}</Badge>
                <Badge variant="secondary" className="text-[10px] rounded-md">{uploadData.totalItems} items</Badge>
                <Badge variant="secondary" className="text-[10px] rounded-md">
                  {Math.round(uploadData.detection.overallConfidence * 100)}% confidence
                </Badge>
              </div>
            </div>
          </div>

          <StorePicker
            groups={uploadData.detection.groups}
            isMixed={uploadData.detection.isMixed}
            vendors={vendors}
            categories={categories}
            onSelectionChange={setSelectedVendors}
            onConfirm={handleStoreConfirm}
          />
        </div>
      )}

      {/* Step 3: Normalizing */}
      {step === "normalizing" && (
        <Card className="border-border/60 shadow-sm">
          <CardContent className="flex h-64 items-center justify-center">
            <div className="text-center space-y-5">
              <div className="relative mx-auto h-16 w-16">
                <div className="absolute inset-0 rounded-2xl border-2 border-primary/15" />
                <div className="absolute inset-0 rounded-2xl border-2 border-primary/50 animate-pulse-ring" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles className="h-7 w-7 text-primary" />
                </div>
              </div>
              <div>
                <p className="font-semibold text-[15px]">Normalizing items...</p>
                <p className="text-sm text-muted-foreground mt-1.5">
                  AI is generating optimized search queries for {allSelectedSlugs.length} vendor{allSelectedSlugs.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Review */}
      {step === "review" && uploadData && (
        <div className="space-y-5">
          <div className="flex items-center gap-3.5 rounded-xl border border-border/60 bg-card px-5 py-3.5 shadow-sm">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <ClipboardCheck className="h-4.5 w-4.5 text-primary" />
            </div>
            <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">{uploadData.filename}</span>
              <Badge variant="secondary" className="text-[10px] rounded-md">{uploadData.totalItems} items</Badge>
              <Badge variant="secondary" className="text-[10px] rounded-md">
                {allSelectedSlugs.length} store{allSelectedSlugs.length !== 1 ? "s" : ""}
              </Badge>
              {normalizedItems.length > 0 && (
                <Badge className="bg-emerald-500/10 text-emerald-700 border border-emerald-200 text-[10px] rounded-md">
                  Normalized
                </Badge>
              )}
            </div>
          </div>

          {normalizeError && (
            <div className="rounded-xl bg-amber-50 border border-amber-200/80 p-4">
              <p className="text-sm text-amber-800 font-medium">
                Normalization skipped: {normalizeError}
              </p>
              <p className="text-xs text-amber-600 mt-1">
                Items shown with original descriptions. Set your ANTHROPIC_API_KEY in .env.local to enable AI normalization.
              </p>
            </div>
          )}

          <ItemsTable
            items={uploadData.items}
            normalized={normalizedItems.length > 0 ? normalizedItems : undefined}
            vendorSlugs={
              normalizedItems.length > 0 ? allSelectedSlugs : undefined
            }
            overrides={itemOverrides}
            onUpdateOverride={handleOverrideChange}
            searchQueryOverrides={searchQueryOverrides}
            onUpdateSearchQuery={handleSearchQueryOverride}
          />

          <div className="flex justify-end gap-3">
            <Button variant="outline" size="sm" onClick={() => setStep("pick-stores")} className="rounded-lg">
              Change Stores
            </Button>
            <Button onClick={() => handleSearch()} className="gap-2 rounded-lg shadow-sm shadow-primary/25">
              <Search className="h-4 w-4" />
              Search {allSelectedSlugs.length} Vendor{allSelectedSlugs.length !== 1 ? "s" : ""}
            </Button>
          </div>
        </div>
      )}

      {/* Step 5: Searching — live log feed with cancel */}
      {step === "searching" && (
        <div className="space-y-5">
          <Card className="border-border/60 shadow-sm overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-3.5">
                  <div className="relative h-9 w-9">
                    <div className="absolute inset-0 rounded-xl border-2 border-primary/15" />
                    <div className="absolute inset-0 rounded-xl border-2 border-primary/50 animate-pulse-ring" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Search className="h-4 w-4 text-primary" />
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Searching vendors...</p>
                    <div className="flex items-center gap-2 mt-1">
                      {searchProgress && (
                        <Badge variant="secondary" className="text-[10px] rounded-md font-mono tabular-nums">
                          {searchProgress.completed} / {searchProgress.total}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px] rounded-md">
                        {Object.values(searchResults).flat().filter((r) => r.productName).length} matches
                      </Badge>
                    </div>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleCancelSearch}
                  className="rounded-lg"
                >
                  Cancel
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {searchProgress && searchProgress.total > 0 && (
                <div className="space-y-2">
                  <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                      style={{
                        width: `${Math.round((searchProgress.completed / searchProgress.total) * 100)}%`,
                      }}
                    />
                  </div>
                  {searchProgress.currentItem && (
                    <p className="text-xs text-muted-foreground truncate">
                      <span className="font-medium text-foreground">{searchProgress.currentVendor}</span>
                      {" — "}
                      {searchProgress.currentItem}
                    </p>
                  )}
                </div>
              )}
              <SearchLog lines={searchLogs} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 6: Results */}
      {step === "results" && uploadData && (
        <SearchResults
          items={uploadData.items}
          results={searchResults}
          internalMatches={internalMatches}
          vendorSlugs={allSelectedSlugs}
          itemCategoryMap={Object.fromEntries(
            uploadData.detection.groups.flatMap((g) =>
              g.itemIndices.map((i) => [i, g.category] as const)
            )
          )}
          normalizedItems={normalizedItems}
          filename={uploadData.filename}
          summary={searchSummary}
          onVendorRefresh={handleVendorRefresh}
          onResume={handleResume}
        />
      )}
    </div>
  );
}
