"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AuthStatus = "connected" | "expired" | "not_configured" | "not_required";

interface VendorCardProps {
  name: string;
  slug: string;
  baseUrl: string;
  authRequired: boolean;
  preferredStrategy: string;
  healthStatus: "healthy" | "degraded" | "down";
  lastHealthCheck?: string;
  sessionMaxAgeHours: number;
  authStatus: AuthStatus;
  authExpiresAt?: string;
  onAuthChange?: () => void;
}

const authStatusConfig: Record<AuthStatus, { label: string; dot: string; badge: string }> = {
  connected: {
    label: "Connected",
    dot: "bg-green-500",
    badge: "bg-green-500/15 text-green-700 border-green-200",
  },
  expired: {
    label: "Expired",
    dot: "bg-yellow-500",
    badge: "bg-yellow-500/15 text-yellow-700 border-yellow-200",
  },
  not_configured: {
    label: "Not connected",
    dot: "bg-gray-400",
    badge: "bg-gray-500/15 text-gray-600 border-gray-200",
  },
  not_required: {
    label: "No auth needed",
    dot: "bg-green-500",
    badge: "bg-green-500/15 text-green-700 border-green-200",
  },
};

export function VendorCard({
  name,
  slug,
  baseUrl,
  authRequired,
  preferredStrategy,
  authStatus,
  authExpiresAt,
  onAuthChange,
}: VendorCardProps) {
  const [loading, setLoading] = useState(false);
  const [actionLabel, setActionLabel] = useState("");
  const config = authStatusConfig[authStatus];

  const handleLogin = async () => {
    setLoading(true);
    setActionLabel("Browser opening... log in manually");
    try {
      const res = await fetch("/api/vendors/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorSlug: slug }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Login failed");
      }
      setActionLabel("Connected!");
      onAuthChange?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed";
      setActionLabel(msg);
    } finally {
      setLoading(false);
      setTimeout(() => setActionLabel(""), 3000);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/vendors/auth/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorSlug: slug }),
      });
      if (!res.ok) throw new Error("Disconnect failed");
      onAuthChange?.();
    } catch (err) {
      console.error("Disconnect error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleHealthCheck = async () => {
    setLoading(true);
    setActionLabel("Checking...");
    try {
      const res = await fetch("/api/vendors/auth/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorSlug: slug }),
      });
      const data = await res.json();
      setActionLabel(data.healthy ? "Healthy" : `Unhealthy: ${data.reason}`);
      onAuthChange?.();
    } catch {
      setActionLabel("Check failed");
    } finally {
      setLoading(false);
      setTimeout(() => setActionLabel(""), 4000);
    }
  };

  return (
    <div className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50">
      <div className="flex items-center gap-3">
        <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", config.dot)} />
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{name}</span>
            {authRequired && (
              <Badge variant="outline" className="text-xs">
                Auth Required
              </Badge>
            )}
            <Badge variant="secondary" className="text-xs">
              {preferredStrategy.toUpperCase()}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {baseUrl}
            {authStatus === "connected" && authExpiresAt && (
              <> &middot; Session expires: {new Date(authExpiresAt).toLocaleString()}</>
            )}
          </p>
          {actionLabel && (
            <p className="mt-1 text-xs font-medium text-blue-600">{actionLabel}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant="outline" className={cn("text-xs", config.badge)}>
          {config.label}
        </Badge>

        {/* Auth-required vendors: Login / Reconnect */}
        {authRequired && (authStatus === "not_configured" || authStatus === "expired") && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogin}
            disabled={loading}
          >
            {loading ? "Waiting..." : authStatus === "expired" ? "Reconnect" : "Login"}
          </Button>
        )}

        {/* Connected vendors: Health check + Disconnect */}
        {authRequired && authStatus === "connected" && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleHealthCheck}
              disabled={loading}
            >
              Check
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDisconnect}
              disabled={loading}
              className="text-destructive hover:text-destructive"
            >
              Disconnect
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
