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
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          allReady ? "bg-green-500" : "bg-yellow-500"
        )}
      />
      <span>
        {ready}/{total} vendors ready
      </span>
    </div>
  );
}
