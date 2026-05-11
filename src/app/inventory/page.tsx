"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Package, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

interface SalesPeriod {
  units: number;
  salesUsd: number;
  costUsd: number;
  marginUsd: number;
  marginPct: number;
}

interface InventoryListRow {
  id: string;
  itemCode: string;
  description: string;
  unitOfMeasure: string;
  rank: "A" | "B" | "C" | "D" | "E" | null;
  primaryLocation: string | null;
  lastSaleDate: string | null;
  derivedUnitCost: number | null;
  isActive: boolean;
  isMasked: boolean;
  salesPyr: SalesPeriod | null;
  salesYtd: SalesPeriod | null;
}

interface CatalogStatus {
  itemCount: number;
  lastImportedAt: string | null;
  lastReportDate: string | null;
}

const PAGE_SIZE = 100;

function formatDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toISOString().slice(0, 10);
}

function daysSince(s: string | null): number | null {
  if (!s) return null;
  return Math.floor((Date.now() - new Date(s).getTime()) / 86400000);
}

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [catalog, setCatalog] = useState<CatalogStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [active, setActive] = useState<"" | "true" | "false">("true");
  const [rank, setRank] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const buildParams = useCallback(
    (skip: number) => {
      const params = new URLSearchParams();
      if (debouncedQ) params.set("q", debouncedQ);
      if (active) params.set("active", active);
      if (rank) params.set("rank", rank);
      params.set("limit", String(PAGE_SIZE));
      params.set("skip", String(skip));
      return params;
    },
    [debouncedQ, active, rank]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listRes, importsRes] = await Promise.all([
        fetch(`/api/inventory?${buildParams(0).toString()}`),
        fetch(`/api/inventory/imports?limit=1`),
      ]);
      const list = await listRes.json();
      const imports = await importsRes.json();
      if (!listRes.ok) throw new Error(list.error || "Failed to load");
      setItems(list.items || []);
      setTotal(list.total ?? 0);
      setHasMore(!!list.hasMore);
      setCatalog(imports.catalog ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/inventory?${buildParams(items.length).toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setItems((prev) => [...prev, ...(data.items || [])]);
      setHasMore(!!data.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }, [buildParams, items.length]);

  useEffect(() => {
    load();
  }, [load]);

  const importAge = daysSince(catalog?.lastImportedAt ?? null);
  const isStale = importAge !== null && importAge > 30;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inventory</h1>
          <p className="text-muted-foreground">
            Your internal SKU catalog imported from the ERP. Surfaced alongside
            vendor results during RFQ search.
          </p>
        </div>
        <Link href="/inventory/import">
          <Button className="gap-2">
            <Upload className="h-4 w-4" />
            Import PDFs
          </Button>
        </Link>
      </div>

      {catalog && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 text-sm">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{catalog.itemCount.toLocaleString()}</span>
              <span className="text-muted-foreground">items in catalog</span>
            </div>
            <div className="text-muted-foreground">
              Last imported:{" "}
              <span className={isStale ? "text-amber-600 font-medium" : "text-foreground"}>
                {formatDate(catalog.lastImportedAt)}
                {importAge !== null && ` (${importAge}d ago)`}
              </span>
            </div>
            {catalog.lastReportDate && (
              <div className="text-muted-foreground">
                ERP report date:{" "}
                <span className="text-foreground">{formatDate(catalog.lastReportDate)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Input
              placeholder="Item code or description…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={active}
              onChange={(e) => setActive(e.target.value as "" | "true" | "false")}
            >
              <option value="true">Active only</option>
              <option value="false">Dormant only</option>
              <option value="">All</option>
            </select>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={rank}
              onChange={(e) => setRank(e.target.value)}
            >
              <option value="">All ranks</option>
              <option value="A">A — top 80%</option>
              <option value="B">B — next 15%</option>
              <option value="C">C — next 4%</option>
              <option value="D">D — next 1%</option>
              <option value="E">E — 0%</option>
            </select>
            <Button variant="outline" onClick={load} disabled={loading}>
              {loading ? "Loading…" : "Refresh"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading && items.length === 0 ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="space-y-3 py-4">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No inventory items match this filter.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{items.length}</span> of{" "}
            <span className="font-semibold text-foreground">{total.toLocaleString()}</span> item
            {total === 1 ? "" : "s"}
          </p>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Item Code</th>
                  <th className="px-3 py-2 text-left font-medium">Description</th>
                  <th className="px-3 py-2 text-left font-medium">UM</th>
                  <th className="px-3 py-2 text-left font-medium">Rank</th>
                  <th className="px-3 py-2 text-right font-medium">Unit Cost</th>
                  <th className="px-3 py-2 text-right font-medium">PYR Units</th>
                  <th className="px-3 py-2 text-right font-medium">PYR Sales</th>
                  <th className="px-3 py-2 text-left font-medium">Last Sale</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-t hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono text-xs">
                      {it.itemCode}
                      {it.isMasked && (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          masked
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {it.description || (
                        <span className="text-muted-foreground italic">(no description)</span>
                      )}
                      {it.primaryLocation && (
                        <span className="ml-2 text-[10px] text-muted-foreground">
                          @{it.primaryLocation}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {it.unitOfMeasure || "—"}
                    </td>
                    <td className="px-3 py-2">
                      {it.rank ? (
                        <Badge variant="outline" className="text-[10px]">
                          {it.rank}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {it.derivedUnitCost !== null ? `$${it.derivedUnitCost.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {it.salesPyr?.units ? it.salesPyr.units.toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {it.salesPyr?.salesUsd
                        ? `$${it.salesPyr.salesUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatDate(it.lastSaleDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                onClick={loadMore}
                disabled={loadingMore}
                className="gap-2"
              >
                {loadingMore
                  ? "Loading..."
                  : `Load more (${(total - items.length).toLocaleString()} remaining)`}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
