"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface AuthInfo {
  vendorSlug: string;
  status: "connected" | "expired" | "not_configured" | "not_required";
}

export function VendorStatusBar() {
  const [statuses, setStatuses] = useState<AuthInfo[]>([]);

  useEffect(() => {
    fetch("/api/vendors/auth")
      .then((r) => (r.ok ? r.json() : { statuses: [] }))
      .then((d) => setStatuses(d.statuses ?? []))
      .catch(() => {});
  }, []);

  if (!statuses.length) return null;

  const ready = statuses.filter(
    (s) => s.status === "connected" || s.status === "not_required"
  ).length;
  const total = statuses.length;
  const allReady = ready === total;

  return (
    <div className="flex items-center gap-2 rounded-full border border-border/60 bg-secondary/50 px-3 py-1.5">
      <span
        className={cn(
          "h-2 w-2 rounded-full ring-2",
          allReady
            ? "bg-emerald-500 ring-emerald-500/20"
            : "bg-amber-500 ring-amber-500/20"
        )}
      />
      <span className="text-xs font-medium text-muted-foreground">
        {ready}/{total} vendors
      </span>
    </div>
  );
}
