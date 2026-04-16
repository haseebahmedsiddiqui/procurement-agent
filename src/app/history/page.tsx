"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  History,
  RotateCcw,
  Trash2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Package,
  Clock,
  CheckCircle2,
  XCircle,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface LastSearchRun {
  searchedAt: string;
  totalResults: number;
  totalFailures: number;
  vendorSlugs: string[];
}

interface HistoryEntry {
  id: string;
  filename: string;
  uploadedAt: string;
  detectedCategory: string;
  categoryConfidence: number;
  selectedVendors: string[];
  status: string;
  itemCount: number;
  searchRunCount: number;
  lastSearchRun: LastSearchRun | null;
}

interface VendorResult {
  vendorSlug: string;
  productName?: string;
  productId?: string;
  productUrl?: string;
  price?: number;
  currency?: string;
  inStock?: boolean;
  source?: string;
  error?: string;
}

interface SearchRunItem {
  itemIndex: number;
  results: VendorResult[];
}

interface SearchRun {
  id: string;
  searchedAt: string;
  vendorSlugs: string[];
  totalResults: number;
  totalFailures: number;
  items: SearchRunItem[];
}

interface RFQItem {
  lineNumber: number;
  description: string;
  impaCode?: string;
  quantity: number;
  unit: string;
}

interface RFQDetail {
  id: string;
  filename: string;
  items: RFQItem[];
  searchRuns: SearchRun[];
}

const STATUS_STYLES: Record<string, string> = {
  uploaded: "bg-zinc-100 text-zinc-600 border border-zinc-200",
  processing: "bg-blue-50 text-blue-700 border border-blue-200",
  completed: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  failed: "bg-red-50 text-red-700 border border-red-200",
};

const CATEGORY_LABEL: Record<string, string> = {
  stationery: "Stationery",
  deck_engine: "Deck / Engine",
  galley_kitchen: "Galley / Kitchen",
  mixed: "Mixed",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

function formatPrice(price?: number, currency?: string): string {
  if (price == null) return "—";
  return `$${price.toFixed(2)}${currency && currency !== "USD" ? ` ${currency}` : ""}`;
}

function RunDetailView({ detail, runIndex }: { detail: RFQDetail; runIndex: number }) {
  const run = detail.searchRuns[runIndex];
  if (!run) return null;

  return (
    <div className="mt-4 space-y-3 animate-fade-in-up">
      <div className="flex items-center gap-3 text-sm">
        <Badge variant="secondary" className="rounded-md text-[10px]">
          {run.vendorSlugs.length} vendors
        </Badge>
        <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-[10px]">
          {run.totalResults} matches
        </Badge>
        {run.totalFailures > 0 && (
          <Badge className="bg-red-50 text-red-700 border border-red-200 rounded-md text-[10px]">
            {run.totalFailures} failures
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {formatDate(run.searchedAt)}
        </span>
      </div>

      <div className="rounded-xl border border-border/60 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-12 text-xs font-semibold">#</TableHead>
              <TableHead className="min-w-[180px] text-xs font-semibold">Item Description</TableHead>
              {run.vendorSlugs.map((slug) => (
                <TableHead key={slug} className="min-w-[180px] text-xs font-semibold">
                  {slug}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.items.map((item, idx) => {
              const runItem = run.items.find((ri) => ri.itemIndex === idx);
              return (
                <TableRow key={idx} className="group">
                  <TableCell className="text-xs text-muted-foreground font-mono tabular-nums">
                    {item.lineNumber}
                  </TableCell>
                  <TableCell>
                    <p className="text-sm font-medium leading-tight">{item.description}</p>
                    {item.impaCode && (
                      <span className="text-[10px] font-mono text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded mt-1 inline-block">
                        {item.impaCode}
                      </span>
                    )}
                  </TableCell>
                  {run.vendorSlugs.map((slug) => {
                    const result = runItem?.results.find((r) => r.vendorSlug === slug);
                    if (!result) {
                      return (
                        <TableCell key={slug} className="text-xs text-muted-foreground">
                          —
                        </TableCell>
                      );
                    }
                    if (result.error) {
                      return (
                        <TableCell key={slug}>
                          <div className="flex items-center gap-1.5 text-xs text-red-600">
                            <XCircle className="h-3 w-3 shrink-0" />
                            <span className="truncate max-w-[150px]">{result.error}</span>
                          </div>
                        </TableCell>
                      );
                    }
                    if (!result.productName) {
                      return (
                        <TableCell key={slug} className="text-xs text-muted-foreground">
                          No result
                        </TableCell>
                      );
                    }
                    return (
                      <TableCell key={slug}>
                        <div className="space-y-1">
                          <p className="text-xs font-medium leading-tight line-clamp-2">
                            {result.productUrl ? (
                              <a
                                href={result.productUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-primary transition-colors inline-flex items-start gap-1"
                              >
                                {result.productName}
                                <ExternalLink className="h-2.5 w-2.5 shrink-0 mt-0.5 opacity-50" />
                              </a>
                            ) : (
                              result.productName
                            )}
                          </p>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold tabular-nums text-emerald-700">
                              {formatPrice(result.price, result.currency)}
                            </span>
                            {result.inStock === false && (
                              <Badge variant="outline" className="text-[9px] h-4 px-1 text-amber-600 border-amber-200">
                                Out of stock
                              </Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedRunIndex, setExpandedRunIndex] = useState<number>(0);
  const [details, setDetails] = useState<Record<string, RFQDetail>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/history");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setEntries(data.rfqs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }

    setExpandedId(id);
    setExpandedRunIndex(0);

    if (!details[id]) {
      setLoadingDetail(id);
      try {
        const res = await fetch(`/api/history/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load");
        setDetails((prev) => ({
          ...prev,
          [id]: {
            id: data.id,
            filename: data.filename,
            items: data.items || [],
            searchRuns: data.searchRuns || [],
          },
        }));
        const runs = data.searchRuns || [];
        if (runs.length > 0) {
          setExpandedRunIndex(runs.length - 1);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load details");
        setExpandedId(null);
      } finally {
        setLoadingDetail(null);
      }
    } else {
      const runs = details[id].searchRuns;
      if (runs.length > 0) {
        setExpandedRunIndex(runs.length - 1);
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this RFQ and all its search history?")) return;
    try {
      const res = await fetch(`/api/history/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setEntries((prev) => prev.filter((e) => e.id !== id));
      if (expandedId === id) setExpandedId(null);
      toast.success("RFQ removed from history");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Comparison History</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Past RFQ searches with full price comparison results
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading} className="gap-2 rounded-lg">
          <RotateCcw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/20">
          <CardContent className="py-4">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading && entries.length === 0 ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="border-border/60 shadow-sm">
              <CardContent className="flex items-center justify-between gap-4 py-5">
                <div className="flex-1 space-y-2.5">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-3.5 w-2/3" />
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-9 w-20 rounded-lg" />
                  <Skeleton className="h-9 w-16 rounded-lg" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="text-center py-12">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted mx-auto mb-4">
              <History className="h-7 w-7 text-muted-foreground" />
            </div>
            <CardTitle className="text-lg">No comparisons yet</CardTitle>
            <CardDescription className="mt-1">
              Upload your first RFQ to get started with price comparison.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center pb-8">
            <Link href="/">
              <Button className="gap-2 rounded-lg shadow-sm shadow-primary/25">
                <Package className="h-4 w-4" />
                Upload RFQ
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => {
            const isExpanded = expandedId === entry.id;
            const detail = details[entry.id];
            const isLoadingThis = loadingDetail === entry.id;
            const hasRuns = entry.searchRunCount > 0;

            return (
              <Card
                key={entry.id}
                className={cn(
                  "border-border/60 shadow-sm transition-all duration-200",
                  isExpanded && "ring-1 ring-primary/20"
                )}
              >
                <CardContent className="py-5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center gap-2.5">
                        <button
                          onClick={() => hasRuns && toggleExpand(entry.id)}
                          className={cn(
                            "flex items-center gap-2 min-w-0",
                            hasRuns && "cursor-pointer hover:text-primary transition-colors"
                          )}
                        >
                          {hasRuns && (
                            isExpanded
                              ? <ChevronDown className="h-4 w-4 text-primary shrink-0" />
                              : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <p className="font-semibold text-[15px] truncate">{entry.filename}</p>
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge className={cn("text-[10px] rounded-md", STATUS_STYLES[entry.status] || "bg-muted")}>
                          {entry.status}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] rounded-md">
                          {entry.itemCount} items
                        </Badge>
                        <Badge variant="outline" className="text-[10px] rounded-md">
                          {CATEGORY_LABEL[entry.detectedCategory] || entry.detectedCategory}
                        </Badge>
                        {hasRuns && (
                          <Badge variant="secondary" className="text-[10px] rounded-md gap-1">
                            <Eye className="h-2.5 w-2.5" />
                            {entry.searchRunCount} run{entry.searchRunCount !== 1 ? "s" : ""}
                          </Badge>
                        )}
                        {entry.lastSearchRun && (
                          <>
                            <span className="text-muted-foreground">|</span>
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                              {entry.lastSearchRun.totalResults} matches
                            </span>
                          </>
                        )}
                        <span className="text-muted-foreground">|</span>
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatRelative(entry.lastSearchRun?.searchedAt || entry.uploadedAt)}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {hasRuns && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 rounded-lg"
                          onClick={() => toggleExpand(entry.id)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </Button>
                      )}
                      <Link href={`/?rfq=${entry.id}`}>
                        <Button size="sm" className="gap-1.5 rounded-lg shadow-sm shadow-primary/25">
                          <RotateCcw className="h-3.5 w-3.5" />
                          Re-run
                        </Button>
                      </Link>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive rounded-lg"
                        onClick={() => handleDelete(entry.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {isExpanded && isLoadingThis && (
                    <div className="mt-4 space-y-2">
                      <Skeleton className="h-4 w-1/4" />
                      <Skeleton className="h-32 w-full rounded-xl" />
                    </div>
                  )}

                  {isExpanded && detail && (
                    <div className="mt-4">
                      {detail.searchRuns.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                          No search results saved for this RFQ.
                        </p>
                      ) : (
                        <>
                          {detail.searchRuns.length > 1 && (
                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-xs font-medium text-muted-foreground">Run:</span>
                              <div className="flex gap-1">
                                {detail.searchRuns.map((run, i) => (
                                  <button
                                    key={run.id}
                                    onClick={() => setExpandedRunIndex(i)}
                                    className={cn(
                                      "px-2.5 py-1 rounded-md text-xs font-medium transition-all",
                                      i === expandedRunIndex
                                        ? "bg-primary text-primary-foreground shadow-sm"
                                        : "bg-muted text-muted-foreground hover:bg-accent"
                                    )}
                                  >
                                    #{i + 1} — {formatRelative(run.searchedAt)}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          <RunDetailView detail={detail} runIndex={expandedRunIndex} />
                        </>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
