"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface CircuitStatus {
  state: "closed" | "open" | "half_open";
  failures: number;
  lastFailure: number | null;
  lastSuccess: number | null;
  openedAt: number | null;
}

function stateLabel(state: CircuitStatus["state"]): string {
  if (state === "closed") return "Healthy";
  if (state === "open") return "Paused";
  return "Probing";
}

function stateBadgeClass(state: CircuitStatus["state"]): string {
  if (state === "closed") return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
  if (state === "open") return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
  return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
}

function timeAgo(epoch: number | null): string {
  if (!epoch) return "never";
  const secs = Math.floor((Date.now() - epoch) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export function VendorHealthDashboard() {
  const [breakers, setBreakers] = useState<Record<string, CircuitStatus> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/vendors/health");
      if (res.ok) {
        const data = await res.json();
        setBreakers(data.breakers ?? {});
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Refresh every 30 seconds
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const handleReset = async (vendorSlug: string) => {
    await fetch("/api/vendors/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorSlug }),
    });
    load();
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 mt-1" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  const entries = Object.entries(breakers ?? {});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vendor Health</CardTitle>
        <CardDescription>
          Circuit breaker status per vendor. Vendors are paused after 3
          consecutive failures and automatically retry after 1 minute.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No vendor activity yet. Circuit breakers are created when vendors are
            first searched.
          </p>
        ) : (
          <div className="space-y-3">
            {entries.map(([slug, status]) => (
              <div
                key={slug}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div className="flex items-center gap-3">
                  <Badge className={stateBadgeClass(status.state)}>
                    {stateLabel(status.state)}
                  </Badge>
                  <span className="font-medium">{slug}</span>
                  <span className="text-xs text-muted-foreground">
                    {status.failures > 0 && `${status.failures} failures`}
                    {status.lastSuccess && ` · last OK ${timeAgo(status.lastSuccess)}`}
                    {status.lastFailure && ` · last fail ${timeAgo(status.lastFailure)}`}
                  </span>
                </div>
                {status.state !== "closed" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleReset(slug)}
                  >
                    Reset
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
