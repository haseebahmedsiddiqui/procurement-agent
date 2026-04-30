"use client";

import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Upload } from "lucide-react";

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
    dot: "bg-emerald-500",
    badge: "bg-emerald-500/10 text-emerald-700 border border-emerald-200/60",
  },
  expired: {
    label: "Expired",
    dot: "bg-amber-500",
    badge: "bg-amber-500/10 text-amber-700 border border-amber-200/60",
  },
  not_configured: {
    label: "Not connected",
    dot: "bg-zinc-400",
    badge: "bg-zinc-500/10 text-zinc-600 border border-zinc-200/60",
  },
  not_required: {
    label: "No auth needed",
    dot: "bg-emerald-500",
    badge: "bg-emerald-500/10 text-emerald-700 border border-emerald-200/60",
  },
};

export function VendorCard({
  name,
  slug,
  baseUrl,
  authRequired,
  preferredStrategy,
  sessionMaxAgeHours,
  authStatus,
  authExpiresAt,
  onAuthChange,
}: VendorCardProps) {
  const [loading, setLoading] = useState(false);
  const [actionLabel, setActionLabel] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (!/\.json$/i.test(file.name)) {
      setActionLabel("File must be a .json export");
      setTimeout(() => setActionLabel(""), 4000);
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setActionLabel("File too large (max 2MB)");
      setTimeout(() => setActionLabel(""), 4000);
      return;
    }

    setUploading(true);
    setActionLabel("Uploading cookies...");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("vendorSlug", slug);
    if (sessionMaxAgeHours) {
      formData.append("days", String(Math.max(1, Math.floor(sessionMaxAgeHours / 24))));
    }

    try {
      const res = await fetch("/api/vendors/auth/upload-cookies", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      setActionLabel(
        `Connected — ${data.cookieCount} cookies (expires ${new Date(
          data.expiresAt
        ).toLocaleDateString()})`
      );
      onAuthChange?.();
    } catch (err) {
      setActionLabel(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      setTimeout(() => setActionLabel(""), 5000);
    }
  };

  return (
    <div className="flex items-center justify-between rounded-xl border border-border/60 p-3.5 transition-colors hover:bg-muted/40">
      <div className="flex items-center gap-3">
        <span className={cn("h-2.5 w-2.5 rounded-full shrink-0 ring-2 ring-offset-2 ring-offset-card", config.dot, "ring-" + config.dot.replace("bg-", "") + "/20")} />
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{name}</span>
            {authRequired && (
              <Badge variant="outline" className="text-[10px] rounded-md">
                Auth Required
              </Badge>
            )}
            <Badge variant="secondary" className="text-[10px] rounded-md">
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
            <p className="mt-1 text-xs font-medium text-primary">{actionLabel}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant="outline" className={cn("text-[10px] rounded-md", config.badge)}>
          {config.label}
        </Badge>

        {/* Hidden file input — triggered by Upload button */}
        {authRequired && (
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleFileChange}
          />
        )}

        {/* Auth-required vendors: Upload Cookies button always visible */}
        {authRequired && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || loading}
            className="gap-1.5 rounded-lg"
            title="Upload Cookie-Editor JSON export"
          >
            <Upload className="h-3.5 w-3.5" />
            {uploading
              ? "Uploading..."
              : authStatus === "connected"
                ? "Refresh"
                : "Upload Cookies"}
          </Button>
        )}

        {/* Auth-required vendors: also show Login (browser flow) when not connected */}
        {authRequired &&
          (authStatus === "not_configured" || authStatus === "expired") && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogin}
              disabled={loading || uploading}
              className="rounded-lg"
              title="Open vendor login in a Playwright browser (local only)"
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
              disabled={loading || uploading}
              className="rounded-lg"
            >
              Check
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDisconnect}
              disabled={loading || uploading}
              className="text-destructive hover:text-destructive rounded-lg"
            >
              Disconnect
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
