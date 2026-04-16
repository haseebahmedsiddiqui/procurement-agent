"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface LogLine {
  level: "info" | "warn" | "error" | "debug";
  message: string;
  data?: Record<string, unknown>;
  ts: number;
}

interface SearchLogProps {
  lines: LogLine[];
  maxLines?: number;
}

const LEVEL_STYLES: Record<LogLine["level"], string> = {
  info: "text-zinc-200",
  debug: "text-zinc-500",
  warn: "text-amber-400",
  error: "text-red-400",
};

const LEVEL_PREFIX: Record<LogLine["level"], string> = {
  info: "INFO ",
  debug: "DEBUG",
  warn: "WARN ",
  error: "ERROR",
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function formatData(data: Record<string, unknown> | undefined): string {
  if (!data) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "object") {
      try {
        parts.push(`${k}=${JSON.stringify(v)}`);
      } catch {
        parts.push(`${k}=[object]`);
      }
    } else {
      const s = String(v);
      parts.push(`${k}=${s.length > 80 ? s.slice(0, 80) + "…" : s}`);
    }
  }
  return parts.length > 0 ? "  " + parts.join(" ") : "";
}

export function SearchLog({ lines, maxLines = 300 }: SearchLogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const visible = lines.length > maxLines ? lines.slice(-maxLines) : lines;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div
      ref={containerRef}
      className="rounded-xl border border-zinc-800/50 bg-zinc-950 text-zinc-300 font-mono text-[11px] leading-relaxed p-4 h-72 overflow-y-auto"
    >
      {visible.length === 0 ? (
        <div className="text-zinc-600">Waiting for activity...</div>
      ) : (
        visible.map((line, i) => (
          <div
            key={`${line.ts}-${i}`}
            className={cn("whitespace-pre-wrap break-all py-px", LEVEL_STYLES[line.level])}
          >
            <span className="text-zinc-600">{formatTime(line.ts)}</span>{" "}
            <span className="text-zinc-500 font-semibold">{LEVEL_PREFIX[line.level]}</span>{" "}
            {line.message}
            <span className="text-zinc-600">{formatData(line.data)}</span>
          </div>
        ))
      )}
    </div>
  );
}
