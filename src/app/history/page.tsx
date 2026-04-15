"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface HistoryEntry {
  id: string;
  filename: string;
  uploadedAt: string;
  detectedCategory: string;
  categoryConfidence: number;
  selectedVendors: string[];
  status: string;
  itemCount: number;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  uploaded: "secondary",
  processing: "default",
  completed: "default",
  failed: "destructive",
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

export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this RFQ from history?")) return;
    try {
      const res = await fetch(`/api/history/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setEntries((prev) => prev.filter((e) => e.id !== id));
      toast.success("RFQ removed from history");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">History</h1>
          <p className="text-muted-foreground">
            Past RFQ lookups. Click Re-run to search the same items again.
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {error && (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading && entries.length === 0 ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-1/2" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-9 w-20" />
                  <Skeleton className="h-9 w-16" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No RFQs yet</CardTitle>
            <CardDescription>
              Upload your first RFQ from the home page to get started.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/">
              <Button>Upload RFQ</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <Card key={entry.id}>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium truncate">{entry.filename}</p>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-[10px]">
                      {entry.itemCount} items
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {CATEGORY_LABEL[entry.detectedCategory] || entry.detectedCategory}
                    </Badge>
                    <Badge
                      variant={STATUS_VARIANT[entry.status] || "outline"}
                      className="text-[10px]"
                    >
                      {entry.status}
                    </Badge>
                    {entry.selectedVendors.length > 0 && (
                      <span>{entry.selectedVendors.length} vendors</span>
                    )}
                    <span>•</span>
                    <span>{formatDate(entry.uploadedAt)}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link href={`/?rfq=${entry.id}`}>
                    <Button size="sm">Re-run</Button>
                  </Link>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => handleDelete(entry.id)}
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
