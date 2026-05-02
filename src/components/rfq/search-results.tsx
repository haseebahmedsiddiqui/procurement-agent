"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart3,
  CheckCircle2,
  XCircle,
  Download,
  Save,
  ExternalLink,
  Loader2,
  AlertTriangle,
  ShieldAlert,
  Ban,
  Plus,
  Link as LinkIcon,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NormalizedItem } from "@/lib/ai/item-normalizer";

interface VendorResult {
  vendorSlug: string;
  productName?: string;
  productId?: string;
  productUrl?: string;
  price?: number;
  currency?: string;
  inStock?: boolean;
  deliveryEstimate?: string;
  reviewCount?: number;
  starRating?: number;
  source: string;
  durationMs: number;
  error?: string;
  errorType?: string;
}

interface RFQItem {
  lineNumber: number;
  description: string;
  impaCode?: string;
  quantity: number;
  unit: string;
}

interface ScrapedProduct {
  productName: string;
  productId: string;
  productUrl: string;
  price: number;
  currency: string;
  inStock: boolean;
  imageUrl?: string;
}

interface SearchResultsProps {
  items: RFQItem[];
  results: Record<number, VendorResult[]>;
  vendorSlugs: string[];
  itemCategoryMap: Record<number, string>;
  normalizedItems?: NormalizedItem[];
  filename?: string;
  summary: {
    totalItems: number;
    totalVendors: number;
    totalResults: number;
    totalFailures: number;
  };
}

type MatchAction = "confirmed" | "rejected" | null;
type SaveStatus = "idle" | "saving" | "success" | "error";

export function SearchResults({
  items,
  results,
  vendorSlugs,
  itemCategoryMap,
  normalizedItems,
  filename,
  summary,
}: SearchResultsProps) {
  // --- Confirm / Reject state ---
  const [actions, setActions] = useState<Record<string, MatchAction>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [rejectUrls, setRejectUrls] = useState<Record<string, string>>({});
  const [rejectingKey, setRejectingKey] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState("");
  const [rejectUrlDraft, setRejectUrlDraft] = useState("");

  // --- Manual product entry (no-result cells) ---
  const [manualProducts, setManualProducts] = useState<Record<string, ScrapedProduct>>({});
  const [addingProductKey, setAddingProductKey] = useState<string | null>(null);
  const [addProductUrlDraft, setAddProductUrlDraft] = useState("");
  const [searchSuggestions, setSearchSuggestions] = useState<Record<string, string>>({});
  const [suggestionDraft, setSuggestionDraft] = useState("");

  // --- Scraping state ---
  const [scrapingKeys, setScrapingKeys] = useState<Set<string>>(new Set());

  // --- Save / Export ---
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // ---------- helpers ----------

  const setAction = (key: string, action: MatchAction) => {
    setActions((prev) => ({ ...prev, [key]: action }));
    if (action === null) {
      setReasons((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setRejectUrls((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    if (saveStatus !== "idle") {
      setSaveStatus("idle");
      setSaveMessage(null);
    }
  };

  const openRejectFor = (key: string) => {
    setRejectingKey(key);
    setReasonDraft(reasons[key] || "");
    setRejectUrlDraft(rejectUrls[key] || "");
  };

  const cancelReject = () => {
    setRejectingKey(null);
    setReasonDraft("");
    setRejectUrlDraft("");
  };

  const scrapeProduct = async (key: string, url: string) => {
    setScrapingKeys((prev) => new Set(prev).add(key));
    try {
      const res = await fetch("/api/scrape-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setManualProducts((prev) => ({ ...prev, [key]: data as ScrapedProduct }));
      toast.success(`Product scraped: ${(data as ScrapedProduct).productName?.slice(0, 60)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scrape failed");
    } finally {
      setScrapingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const commitReject = () => {
    if (!rejectingKey) return;
    const trimmedReason = reasonDraft.trim();
    const trimmedUrl = rejectUrlDraft.trim();

    setReasons((prev) => ({ ...prev, [rejectingKey]: trimmedReason }));
    setActions((prev) => ({ ...prev, [rejectingKey]: "rejected" }));
    if (trimmedUrl) {
      setRejectUrls((prev) => ({ ...prev, [rejectingKey]: trimmedUrl }));
      scrapeProduct(rejectingKey, trimmedUrl);
    }
    if (saveStatus !== "idle") {
      setSaveStatus("idle");
      setSaveMessage(null);
    }
    setRejectingKey(null);
    setReasonDraft("");
    setRejectUrlDraft("");
  };

  const openAddProduct = (key: string) => {
    setAddingProductKey(key);
    setAddProductUrlDraft("");
    setSuggestionDraft(searchSuggestions[key] || "");
  };

  const cancelAddProduct = () => {
    setAddingProductKey(null);
    setAddProductUrlDraft("");
    setSuggestionDraft("");
  };

  const commitAddProduct = () => {
    if (!addingProductKey) return;
    const url = addProductUrlDraft.trim();
    const suggestion = suggestionDraft.trim();
    if (suggestion) {
      setSearchSuggestions((prev) => ({ ...prev, [addingProductKey]: suggestion }));
    }
    if (url) {
      scrapeProduct(addingProductKey, url);
    }
    setAddingProductKey(null);
    setAddProductUrlDraft("");
    setSuggestionDraft("");
  };

  const confirmedCount = Object.values(actions).filter((a) => a === "confirmed").length;
  const rejectedCount = Object.values(actions).filter((a) => a === "rejected").length;
  const manualCount = Object.keys(manualProducts).length;
  const feedbackCount = confirmedCount + rejectedCount + manualCount;

  // ---------- save ----------

  const handleSaveToDictionary = async () => {
    if (feedbackCount === 0) return;

    const matches: Array<Record<string, unknown>> = [];
    const rejections: Array<Record<string, unknown>> = [];
    const manualEntries: Array<Record<string, unknown>> = [];

    // Confirmed + rejected from actions
    for (const [key, action] of Object.entries(actions)) {
      if (action !== "confirmed" && action !== "rejected") continue;
      const [idxStr, vendorSlug] = key.split("-");
      const idx = Number(idxStr);
      const item = items[idx];
      if (!item) continue;

      const vr = (results[idx] || []).find((r) => r.vendorSlug === vendorSlug);
      if (!vr || !vr.productName) continue;

      const norm = normalizedItems?.find((n) => n.index === idx);
      const category = itemCategoryMap[idx];
      if (!category) continue;

      const base = {
        rfqDescription: item.description,
        normalizedName: norm?.normalizedName || item.description,
        impaCode: item.impaCode,
        category,
        vendorSlug,
        productName: vr.productName,
        productId: vr.productId,
        productUrl: vr.productUrl,
        price: vr.price,
        confidence: undefined as number | undefined,
      };

      if (action === "confirmed") {
        if (!vr.productId || !vr.productUrl) continue;
        matches.push(base);
      } else {
        const reason = reasons[key]?.trim();
        const suggestedProductUrl = rejectUrls[key]?.trim();
        rejections.push({
          ...base,
          ...(reason ? { reason } : {}),
          ...(suggestedProductUrl ? { suggestedProductUrl } : {}),
        });
      }
    }

    // Manual products (from no-result cells that had URL pasted)
    for (const [key, product] of Object.entries(manualProducts)) {
      const [idxStr, vendorSlug] = key.split("-");
      const idx = Number(idxStr);
      const item = items[idx];
      if (!item) continue;

      // Skip if this key was already handled as a rejection+URL (it's already in rejections)
      if (actions[key] === "rejected" && rejectUrls[key]) continue;

      const norm = normalizedItems?.find((n) => n.index === idx);
      const category = itemCategoryMap[idx];
      if (!category) continue;

      manualEntries.push({
        rfqDescription: item.description,
        normalizedName: norm?.normalizedName || item.description,
        impaCode: item.impaCode,
        category,
        vendorSlug,
        productName: product.productName,
        productId: product.productId,
        productUrl: product.productUrl,
        price: product.price,
        searchSuggestion: searchSuggestions[key]?.trim() || undefined,
      });
    }

    if (matches.length === 0 && rejections.length === 0 && manualEntries.length === 0) {
      setSaveStatus("error");
      setSaveMessage("No valid feedback to save.");
      return;
    }

    setSaveStatus("saving");
    setSaveMessage(null);

    try {
      const res = await fetch("/api/dictionary/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matches, rejections, manualEntries }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setSaveStatus("success");
      const parts: string[] = [];
      if (data.savedMappings > 0) parts.push(`${data.savedMappings} confirmed`);
      if (data.savedRejections > 0) parts.push(`${data.savedRejections} rejected`);
      if (data.savedManualEntries > 0) parts.push(`${data.savedManualEntries} manual`);
      const summaryText =
        parts.join(" + ") +
        (data.savedItems > 0
          ? ` (${data.savedItems} new dictionary item${data.savedItems === 1 ? "" : "s"})`
          : "");
      setSaveMessage(summaryText);
      toast.success(`Saved feedback: ${summaryText}`);
    } catch (err) {
      setSaveStatus("error");
      const msg = err instanceof Error ? err.message : "Save failed";
      setSaveMessage(msg);
      toast.error(msg);
    }
  };

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const baseName = (filename || "rfq").replace(/\.(xlsx|xls)$/i, "");
      const exportFilename = `${baseName}-comparison`;

      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: exportFilename,
          items,
          vendorSlugs,
          results,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Export failed (HTTP ${res.status})`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${exportFilename}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${exportFilename}.xlsx`);
    } catch (err) {
      setSaveStatus("error");
      const msg = err instanceof Error ? err.message : "Export failed";
      setSaveMessage(msg);
      toast.error(msg);
    } finally {
      setExporting(false);
    }
  };

  // ---------- render helpers ----------

  function renderManualProduct(key: string, product: ScrapedProduct) {
    return (
      <div className="rounded-lg p-2.5 -m-1 space-y-1.5 ring-1 ring-primary/40 bg-primary/5">
        <p className="text-sm font-medium leading-tight">
          <a
            href={product.productUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline inline-flex items-center gap-1"
          >
            {product.productName}
            <ExternalLink className="h-3 w-3 text-muted-foreground" />
          </a>
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-base tabular-nums">
            ${product.price.toFixed(2)}
          </span>
          <Badge className="text-[9px] h-4 bg-primary/15 text-primary">
            Manual
          </Badge>
          {product.inStock ? (
            <Badge
              variant="secondary"
              className="text-[9px] h-4 bg-emerald-500/10 text-emerald-700"
            >
              In Stock
            </Badge>
          ) : (
            <Badge variant="destructive" className="text-[9px] h-4">
              OOS
            </Badge>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">
          {product.productId} &middot; scraped
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="h-5 text-[10px] px-1 text-muted-foreground"
          onClick={() =>
            setManualProducts((prev) => {
              const next = { ...prev };
              delete next[key];
              return next;
            })
          }
        >
          Remove
        </Button>
      </div>
    );
  }

  function renderNoResultCell(key: string, vr?: VendorResult) {
    const manual = manualProducts[key];
    const isScraping = scrapingKeys.has(key);
    const isAdding = addingProductKey === key;

    if (isScraping) {
      return (
        <div className="flex flex-col items-center gap-1 py-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-[10px] text-muted-foreground">Scraping...</span>
        </div>
      );
    }

    if (manual) {
      return renderManualProduct(key, manual);
    }

    if (isAdding) {
      return (
        <div className="space-y-1.5 p-1">
          <input
            autoFocus
            type="url"
            value={addProductUrlDraft}
            placeholder="Paste product URL"
            onChange={(e) => setAddProductUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitAddProduct();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelAddProduct();
              }
            }}
            className="w-full text-[11px] rounded border border-input bg-background px-2 py-1 outline-none focus:border-primary"
          />
          <input
            type="text"
            value={suggestionDraft}
            placeholder="Search suggestion for next time (optional)"
            onChange={(e) => setSuggestionDraft(e.target.value)}
            className="w-full text-[11px] rounded border border-input bg-background px-2 py-1 outline-none focus:border-primary"
          />
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] px-2 gap-1"
              onClick={commitAddProduct}
              disabled={!addProductUrlDraft.trim()}
            >
              <Plus className="h-3 w-3" />
              Add
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-[10px] px-2"
              onClick={cancelAddProduct}
            >
              Cancel
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center gap-1.5">
        {vr?.errorType === "captcha" ? (
          <div className="inline-flex items-center gap-1 text-amber-600">
            <AlertTriangle className="h-3 w-3" />
            <span className="text-[10px]">CAPTCHA</span>
          </div>
        ) : vr?.errorType === "auth_expired" ? (
          <div className="inline-flex items-center gap-1 text-orange-600">
            <ShieldAlert className="h-3 w-3" />
            <span className="text-[10px]">Login required</span>
          </div>
        ) : vr?.errorType === "blocked" ? (
          <div className="inline-flex items-center gap-1 text-destructive">
            <Ban className="h-3 w-3" />
            <span className="text-[10px]">Blocked</span>
          </div>
        ) : vr?.error ? (
          <span className="text-destructive text-[10px]">{vr.error}</span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
        {searchSuggestions[key] && (
          <p className="text-[10px] text-muted-foreground italic">
            Suggested: "{searchSuggestions[key]}"
          </p>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[10px] px-2 gap-1 text-primary"
          onClick={() => openAddProduct(key)}
        >
          <Plus className="h-3 w-3" />
          Add Product
        </Button>
      </div>
    );
  }

  // ---------- main render ----------

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Items</p>
            <p className="text-2xl font-bold">{summary.totalItems || items.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Matches Found</p>
            <p className="text-2xl font-bold text-emerald-600">{summary.totalResults}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Failed</p>
            <p className={cn("text-2xl font-bold", summary.totalFailures > 0 ? "text-destructive" : "text-muted-foreground")}>
              {summary.totalFailures}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Feedback</p>
            <p className={cn("text-2xl font-bold", feedbackCount > 0 ? "text-primary" : "text-muted-foreground")}>
              {feedbackCount}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Results table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4 text-primary" />
            Comparison Results
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="w-12 sticky left-0 bg-muted/30">#</TableHead>
                  <TableHead className="min-w-[200px] sticky left-12 bg-muted/30">
                    RFQ Item
                  </TableHead>
                  {vendorSlugs.map((slug) => (
                    <TableHead key={slug} className="min-w-[250px] text-center">
                      {slug}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, idx) => {
                  const itemResults = results[idx] || [];

                  const priced = itemResults.filter(
                    (r) => typeof r.price === "number" && r.inStock !== false
                  );
                  const cheapestVendorSlug =
                    priced.length > 0
                      ? priced.reduce((min, r) =>
                          (r.price ?? Infinity) < (min.price ?? Infinity) ? r : min
                        ).vendorSlug
                      : null;

                  return (
                    <TableRow key={idx} className="group">
                      <TableCell className="text-muted-foreground text-xs sticky left-0 bg-background group-hover:bg-muted/20">
                        {item.lineNumber}
                      </TableCell>
                      <TableCell className="sticky left-12 bg-background group-hover:bg-muted/20">
                        <div>
                          <p className="text-sm font-medium leading-snug">{item.description}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {item.quantity} {item.unit}
                            {item.impaCode && (
                              <span className="ml-1.5 font-mono text-[10px] bg-muted px-1 py-0.5 rounded">
                                IMPA {item.impaCode}
                              </span>
                            )}
                          </p>
                        </div>
                      </TableCell>
                      {vendorSlugs.map((slug) => {
                        const vr = itemResults.find((r) => r.vendorSlug === slug);
                        const key = `${idx}-${slug}`;
                        const action = actions[key];
                        const isCheapest = cheapestVendorSlug === slug;
                        const isScraping = scrapingKeys.has(key);

                        if (!vr || !vr.productName) {
                          return (
                            <TableCell key={slug} className="align-top text-center">
                              {renderNoResultCell(key, vr)}
                            </TableCell>
                          );
                        }

                        // Show scraped alternate product if rejected with URL
                        if (action === "rejected" && manualProducts[key]) {
                          return (
                            <TableCell key={slug} className="align-top">
                              {renderManualProduct(key, manualProducts[key])}
                              <div className="mt-1.5 space-y-0.5">
                                <Badge
                                  variant="outline"
                                  className="text-[10px] cursor-pointer bg-destructive/10 text-destructive border-destructive/30"
                                  onClick={() => setAction(key, null)}
                                >
                                  Rejected original (undo)
                                </Badge>
                                {reasons[key] && (
                                  <p className="text-[10px] text-muted-foreground italic line-clamp-2">
                                    &ldquo;{reasons[key]}&rdquo;
                                  </p>
                                )}
                              </div>
                            </TableCell>
                          );
                        }

                        return (
                          <TableCell key={slug} className="align-top">
                            <div
                              className={cn(
                                "rounded-lg p-2.5 -m-1 space-y-1.5 transition-all",
                                isCheapest &&
                                  action !== "rejected" &&
                                  "ring-1 ring-emerald-400/60 bg-emerald-50/50",
                                action === "confirmed" && "bg-primary/5 ring-1 ring-primary/30",
                                action === "rejected" && "bg-muted/50 opacity-50"
                              )}
                            >
                              <p className="text-sm font-medium leading-tight">
                                {vr.productUrl ? (
                                  <a
                                    href={vr.productUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:underline inline-flex items-center gap-1"
                                  >
                                    {vr.productName}
                                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                                  </a>
                                ) : (
                                  vr.productName
                                )}
                              </p>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-base tabular-nums">
                                  ${vr.price?.toFixed(2)}
                                </span>
                                {isCheapest && action !== "rejected" && (
                                  <Badge className="text-[9px] h-4 bg-emerald-500/15 text-emerald-700">
                                    Best
                                  </Badge>
                                )}
                                {vr.inStock ? (
                                  <Badge
                                    variant="secondary"
                                    className="text-[9px] h-4 bg-emerald-500/10 text-emerald-700"
                                  >
                                    In Stock
                                  </Badge>
                                ) : (
                                  <Badge variant="destructive" className="text-[9px] h-4">
                                    OOS
                                  </Badge>
                                )}
                              </div>
                              {/* Review count + star rating (Amazon) */}
                              {(vr.starRating || vr.reviewCount) && (
                                <div className="flex items-center gap-1">
                                  {vr.starRating && (
                                    <span className="inline-flex items-center gap-0.5 text-amber-500">
                                      <Star className="h-3 w-3 fill-amber-500" />
                                      <span className="text-[11px] font-medium text-foreground">
                                        {vr.starRating.toFixed(1)}
                                      </span>
                                    </span>
                                  )}
                                  {vr.reviewCount && (
                                    <span className="text-[10px] text-muted-foreground">
                                      ({vr.reviewCount.toLocaleString()} reviews)
                                    </span>
                                  )}
                                </div>
                              )}
                              <p className="text-[10px] text-muted-foreground">
                                {vr.productId} &middot; {vr.source} &middot; {vr.durationMs}ms
                              </p>

                              {/* Reject form (reason + alternate URL) */}
                              {rejectingKey === key ? (
                                <div className="pt-0.5 space-y-1">
                                  <textarea
                                    autoFocus
                                    value={reasonDraft}
                                    placeholder="Why is this wrong? (optional)"
                                    onChange={(e) => setReasonDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                        e.preventDefault();
                                        commitReject();
                                      } else if (e.key === "Escape") {
                                        e.preventDefault();
                                        cancelReject();
                                      }
                                    }}
                                    rows={2}
                                    className="w-full text-[11px] rounded border border-input bg-background px-2 py-1 outline-none focus:border-primary resize-none"
                                  />
                                  <div className="flex items-center gap-1">
                                    <LinkIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                                    <input
                                      type="url"
                                      value={rejectUrlDraft}
                                      placeholder="Alternate product URL (optional)"
                                      onChange={(e) => setRejectUrlDraft(e.target.value)}
                                      className="w-full text-[11px] rounded border border-input bg-background px-2 py-1 outline-none focus:border-primary"
                                    />
                                  </div>
                                  <div className="flex gap-1">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-6 text-[10px] px-2 gap-1 text-destructive"
                                      onClick={commitReject}
                                    >
                                      <XCircle className="h-3 w-3" />
                                      Reject
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 text-[10px] px-2"
                                      onClick={cancelReject}
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                              ) : isScraping ? (
                                <div className="flex items-center gap-1.5 pt-0.5">
                                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                                  <span className="text-[10px] text-muted-foreground">
                                    Scraping alternate...
                                  </span>
                                </div>
                              ) : action === null || action === undefined ? (
                                <div className="flex gap-1 pt-0.5">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 text-[10px] px-2 gap-1"
                                    onClick={() => setAction(key, "confirmed")}
                                  >
                                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                    Confirm
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 text-[10px] px-2 gap-1 text-destructive"
                                    onClick={() => openRejectFor(key)}
                                  >
                                    <XCircle className="h-3 w-3" />
                                    Reject
                                  </Button>
                                </div>
                              ) : (
                                <div className="space-y-0.5">
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "text-[10px] cursor-pointer",
                                      action === "confirmed"
                                        ? "bg-primary/10 text-primary border-primary/30"
                                        : "bg-destructive/10 text-destructive border-destructive/30"
                                    )}
                                    onClick={() => setAction(key, null)}
                                    title={
                                      action === "rejected" && reasons[key]
                                        ? `Reason: ${reasons[key]}`
                                        : undefined
                                    }
                                  >
                                    {action === "confirmed" ? "Confirmed" : "Rejected"} (undo)
                                  </Badge>
                                  {action === "rejected" && reasons[key] && (
                                    <p className="text-[10px] text-muted-foreground italic line-clamp-2">
                                      &ldquo;{reasons[key]}&rdquo;
                                    </p>
                                  )}
                                </div>
                              )}
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
        </CardContent>
      </Card>

      {/* Action bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                {confirmedCount} confirmed, {rejectedCount} rejected
                {manualCount > 0 && `, ${manualCount} manual`}
                {" — "}
                {summary.totalResults - confirmedCount - rejectedCount} pending
              </p>
              {saveMessage && (
                <p
                  className={cn(
                    "text-xs",
                    saveStatus === "success" && "text-emerald-700",
                    saveStatus === "error" && "text-destructive"
                  )}
                >
                  {saveMessage}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportExcel}
                disabled={exporting || items.length === 0}
                className="gap-1.5"
              >
                {exporting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {exporting ? "Exporting..." : "Export Excel"}
              </Button>
              <Button
                size="sm"
                disabled={feedbackCount === 0 || saveStatus === "saving"}
                onClick={handleSaveToDictionary}
                className="gap-1.5"
              >
                {saveStatus === "saving" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : saveStatus === "success" ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {saveStatus === "saving"
                  ? "Saving..."
                  : saveStatus === "success"
                  ? "Saved"
                  : `Save Feedback (${feedbackCount})`}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
