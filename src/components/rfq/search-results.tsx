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
  const [actions, setActions] = useState<Record<string, MatchAction>>({});
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const setAction = (key: string, action: MatchAction) => {
    setActions((prev) => ({ ...prev, [key]: action }));
    if (saveStatus !== "idle") {
      setSaveStatus("idle");
      setSaveMessage(null);
    }
  };

  const confirmedCount = Object.values(actions).filter((a) => a === "confirmed").length;
  const rejectedCount = Object.values(actions).filter((a) => a === "rejected").length;

  const handleSaveToDictionary = async () => {
    if (confirmedCount === 0 && rejectedCount === 0) return;

    const matches: Array<Record<string, unknown>> = [];
    const rejections: Array<Record<string, unknown>> = [];

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
        rejections.push(base);
      }
    }

    if (matches.length === 0 && rejections.length === 0) {
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
        body: JSON.stringify({ matches, rejections }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setSaveStatus("success");
      const parts: string[] = [];
      if (data.savedMappings > 0) {
        parts.push(`${data.savedMappings} confirmed`);
      }
      if (data.savedRejections > 0) {
        parts.push(`${data.savedRejections} rejected`);
      }
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
            <p className="text-xs text-muted-foreground">Confirmed</p>
            <p className={cn("text-2xl font-bold", confirmedCount > 0 ? "text-primary" : "text-muted-foreground")}>
              {confirmedCount}
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

                        if (!vr || !vr.productName) {
                          return (
                            <TableCell key={slug} className="align-top text-center">
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
                              <p className="text-[10px] text-muted-foreground">
                                {vr.productId} &middot; {vr.source} &middot; {vr.durationMs}ms
                              </p>
                              {action === null || action === undefined ? (
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
                                    onClick={() => setAction(key, "rejected")}
                                  >
                                    <XCircle className="h-3 w-3" />
                                    Reject
                                  </Button>
                                </div>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[10px] cursor-pointer",
                                    action === "confirmed"
                                      ? "bg-primary/10 text-primary border-primary/30"
                                      : "bg-destructive/10 text-destructive border-destructive/30"
                                  )}
                                  onClick={() => setAction(key, null)}
                                >
                                  {action === "confirmed" ? "Confirmed" : "Rejected"} (undo)
                                </Badge>
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
                {confirmedCount} confirmed, {rejectedCount} rejected,{" "}
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
                disabled={
                  confirmedCount + rejectedCount === 0 || saveStatus === "saving"
                }
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
                  : `Save Feedback (${confirmedCount + rejectedCount})`}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
