"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

interface VendorMapping {
  slug: string;
  productId: string;
  productUrl: string;
  verified: boolean;
}

interface DictionaryItem {
  id: string;
  rfqDescription: string;
  normalizedName: string;
  impaCode?: string;
  category: string;
  vendors: VendorMapping[];
  updatedAt: string;
}

const CATEGORY_OPTIONS = [
  { value: "", label: "All categories" },
  { value: "stationery", label: "Stationery" },
  { value: "deck_engine", label: "Deck / Engine" },
  { value: "galley_kitchen", label: "Galley / Kitchen" },
];

const CATEGORY_LABEL: Record<string, string> = {
  stationery: "Stationery",
  deck_engine: "Deck / Engine",
  galley_kitchen: "Galley / Kitchen",
};

export default function DictionaryPage() {
  const [items, setItems] = useState<DictionaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [category, setCategory] = useState("");
  const [vendor, setVendor] = useState("");

  // Debounce search input so we don't fire a request on every keystroke.
  // 300ms feels responsive without hammering the API on rapid typing.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedQ) params.set("q", debouncedQ);
      if (category) params.set("category", category);
      if (vendor) params.set("vendor", vendor);
      const res = await fetch(`/api/dictionary?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setItems(data.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, category, vendor]);

  useEffect(() => {
    load();
  }, [load]);

  const allVendorSlugs = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) {
      for (const v of it.vendors) s.add(v.slug);
    }
    return Array.from(s).sort();
  }, [items]);

  const handleDeleteItem = async (id: string) => {
    if (!confirm("Delete this dictionary item entirely?")) return;
    try {
      const res = await fetch(`/api/dictionary/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setItems((prev) => prev.filter((i) => i.id !== id));
      toast.success("Dictionary item deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleDeleteVendor = async (id: string, vendorSlug: string) => {
    if (!confirm(`Remove ${vendorSlug} mapping from this item?`)) return;
    try {
      const res = await fetch(`/api/dictionary/${id}?vendor=${vendorSlug}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      setItems((prev) =>
        prev.map((i) =>
          i.id === id
            ? { ...i, vendors: i.vendors.filter((v) => v.slug !== vendorSlug) }
            : i
        )
      );
      toast.success(`Removed ${vendorSlug} mapping`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Product Dictionary</h1>
        <p className="text-muted-foreground">
          Confirmed item-to-vendor mappings. Future RFQ lookups for these items
          short-circuit the AI extraction layer.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Input
              placeholder="Search name / description / IMPA…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
            >
              <option value="">All vendors</option>
              {allVendorSlugs.map((slug) => (
                <option key={slug} value={slug}>
                  {slug}
                </option>
              ))}
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
                <Skeleton className="h-4 w-1/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No dictionary items match this filter. Confirm matches in the search
            results to populate it.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {items.length} item{items.length === 1 ? "" : "s"}
          </p>
          {items.map((item) => (
            <Card key={item.id}>
              <CardContent className="space-y-3 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{item.normalizedName}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {item.rfqDescription}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-[10px]">
                        {CATEGORY_LABEL[item.category] || item.category}
                      </Badge>
                      {item.impaCode && (
                        <Badge variant="outline" className="text-[10px]">
                          IMPA: {item.impaCode}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px]">
                        {item.vendors.length} vendor
                        {item.vendors.length === 1 ? "" : "s"}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => handleDeleteItem(item.id)}
                  >
                    Delete item
                  </Button>
                </div>

                {item.vendors.length > 0 && (
                  <div className="space-y-1 border-t pt-3">
                    {item.vendors.map((v) => (
                      <div
                        key={v.slug}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0 flex-1 flex items-center gap-2">
                          <Badge
                            variant="secondary"
                            className="text-[10px] font-mono"
                          >
                            {v.slug}
                          </Badge>
                          <span className="font-mono text-muted-foreground">
                            {v.productId}
                          </span>
                          {v.productUrl && (
                            <Link
                              href={v.productUrl}
                              target="_blank"
                              className="text-blue-600 hover:underline truncate"
                            >
                              view
                            </Link>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[10px] text-destructive"
                          onClick={() => handleDeleteVendor(item.id, v.slug)}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
