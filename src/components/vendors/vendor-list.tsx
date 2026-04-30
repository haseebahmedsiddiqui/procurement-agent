"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { VendorCard, type AuthStatus } from "./vendor-card";
import { AddVendorDialog } from "./add-vendor-dialog";

interface Vendor {
  _id: string;
  name: string;
  slug: string;
  category: string;
  enabled: boolean;
  baseUrl: string;
  authRequired: boolean;
  preferredStrategy: string;
  healthStatus: "healthy" | "degraded" | "down";
  lastHealthCheck?: string;
  sessionMaxAgeHours: number;
}

interface Category {
  _id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  defaultVendors: string[];
}

interface VendorAuthInfo {
  vendorSlug: string;
  status: AuthStatus;
  expiresAt?: string;
}

interface VendorData {
  vendors: Vendor[];
  categories: Category[];
}

export function VendorList() {
  const [data, setData] = useState<VendorData | null>(null);
  const [authStatuses, setAuthStatuses] = useState<Record<string, VendorAuthInfo>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAuthStatuses = useCallback(async () => {
    try {
      const res = await fetch("/api/vendors/auth");
      if (!res.ok) return;
      const { statuses } = await res.json();
      const map: Record<string, VendorAuthInfo> = {};
      for (const s of statuses) {
        map[s.vendorSlug] = s;
      }
      setAuthStatuses(map);
    } catch {
      // Auth status fetch is non-critical
    }
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/vendors").then((res) => {
        if (!res.ok) throw new Error("Failed to fetch vendors");
        return res.json();
      }),
      fetch("/api/vendors/auth")
        .then((res) => (res.ok ? res.json() : { statuses: [] }))
        .catch(() => ({ statuses: [] })),
    ])
      .then(([vendorData, authData]) => {
        setData(vendorData);
        const map: Record<string, VendorAuthInfo> = {};
        for (const s of authData.statuses) {
          map[s.vendorSlug] = s;
        }
        setAuthStatuses(map);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex gap-3">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-6 w-24" />
          </div>
          <Skeleton className="h-9 w-32" />
        </div>
        {[0, 1, 2].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-48" />
              <Skeleton className="mt-2 h-4 w-72" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex h-48 items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-destructive">{error}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Make sure Docker is running and the database is seeded.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { vendors, categories } = data;

  const vendorsByCategory = categories.map((cat) => ({
    category: cat,
    vendors: vendors.filter((v) => v.category === cat.slug),
  }));

  const totalVendors = vendors.length;
  const connectedVendors = Object.values(authStatuses).filter(
    (s) => s.status === "connected" || s.status === "not_required"
  ).length;
  const expiredVendors = Object.values(authStatuses).filter(
    (s) => s.status === "expired"
  ).length;
  const needsAuth = Object.values(authStatuses).filter(
    (s) => s.status === "not_configured"
  ).length;

  return (
    <div className="space-y-6">
      {/* Cookie upload help banner */}
      <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4 text-sm">
        <p className="font-semibold text-foreground mb-1">
          How to refresh a vendor session
        </p>
        <p className="text-muted-foreground leading-relaxed">
          1. Install <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">Cookie-Editor</span>{" "}
          extension in your browser. 2. Log into the vendor site. 3. Click the extension, choose{" "}
          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">Export → Export as JSON</span>,
          then save to a file. 4. Click <span className="font-medium text-foreground">Upload Cookies</span> below
          and select the file. Sessions typically last 2–14 days depending on the vendor.
        </p>
      </div>

      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-3">
          <Badge variant="secondary" className="text-sm">
            {totalVendors} vendors
          </Badge>
          <Badge
            variant="secondary"
            className="bg-green-500/15 text-green-700 text-sm"
          >
            {connectedVendors} ready
          </Badge>
          {expiredVendors > 0 && (
            <Badge
              variant="secondary"
              className="bg-yellow-500/15 text-yellow-700 text-sm"
            >
              {expiredVendors} expired
            </Badge>
          )}
          {needsAuth > 0 && (
            <Badge
              variant="secondary"
              className="bg-gray-500/15 text-gray-600 text-sm"
            >
              {needsAuth} need login
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={fetchAuthStatuses}>
            Refresh
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <AddVendorDialog onCreated={reload} />
        </div>
      </div>

      {vendorsByCategory.map(({ category, vendors: catVendors }) => (
        <Card key={category.slug}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span>{category.icon}</span>
              <span>{category.name}</span>
              <Badge variant="outline" className="ml-2 text-xs">
                {catVendors.length} stores
              </Badge>
            </CardTitle>
            <CardDescription>{category.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {catVendors.map((vendor) => {
                const auth = authStatuses[vendor.slug];
                return (
                  <VendorCard
                    key={vendor.slug}
                    name={vendor.name}
                    slug={vendor.slug}
                    baseUrl={vendor.baseUrl}
                    authRequired={vendor.authRequired}
                    preferredStrategy={vendor.preferredStrategy}
                    healthStatus={vendor.healthStatus}
                    lastHealthCheck={vendor.lastHealthCheck}
                    sessionMaxAgeHours={vendor.sessionMaxAgeHours}
                    authStatus={auth?.status ?? (vendor.authRequired ? "not_configured" : "not_required")}
                    authExpiresAt={auth?.expiresAt}
                    onAuthChange={fetchAuthStatuses}
                  />
                );
              })}
              {catVendors.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No vendors in this category yet.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
