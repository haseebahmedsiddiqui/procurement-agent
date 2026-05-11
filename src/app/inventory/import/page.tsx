"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, FileText, Loader2, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ImportFile {
  name: string;
  type: "item-listing" | "sales-report" | "unknown";
  rowCount: number;
}

interface ImportResult {
  created: number;
  updated: number;
  unchanged: number;
  masked: number;
  parseErrors: { line: number; reason: string; itemCode?: string }[];
}

interface ImportHistoryItem {
  id: string;
  importedAt: string;
  importedBy: string | null;
  reportDate: string | null;
  files: ImportFile[];
  result: ImportResult;
}

function formatDateTime(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return `${d.toISOString().slice(0, 10)} ${d.toTimeString().slice(0, 5)}`;
}

export default function InventoryImportPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/inventory/imports?limit=10");
      const data = await res.json();
      if (res.ok) setHistory(data.imports || []);
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleFiles = useCallback((incoming: File[]) => {
    const pdfs = incoming.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length !== incoming.length) {
      toast.error("Only PDF files are accepted");
    }
    setFiles((prev) => {
      const map = new Map<string, File>();
      for (const f of [...prev, ...pdfs]) map.set(f.name, f);
      return [...map.values()].slice(0, 4);
    });
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      const dropped = Array.from(e.dataTransfer.files);
      handleFiles(dropped);
    },
    [handleFiles]
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;
      handleFiles(Array.from(e.target.files));
      e.target.value = "";
    },
    [handleFiles]
  );

  const removeFile = (name: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  };

  const submit = async () => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      const res = await fetch("/api/inventory/import", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      const s = data.summary;
      toast.success(
        `Import complete: ${s.created} new, ${s.updated} updated, ${s.unchanged} unchanged`
      );
      setFiles([]);
      loadHistory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href="/inventory"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Back to inventory
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Import inventory</h1>
        <p className="text-muted-foreground">
          Upload the ICR740 (Warehouse/Item Listing) and/or ICR720 (Item Sales
          Report) PDFs from your ERP. Files are auto-detected. Re-importing
          overwrites matching records in place.
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed p-12 transition-colors",
              dragActive
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-muted/30"
            )}
          >
            <Upload className="h-8 w-8 text-muted-foreground" />
            <div className="text-center">
              <p className="text-sm font-medium">
                Drop PDFs here or click to browse
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Up to 4 PDF files
              </p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,application/pdf"
              multiple
              hidden
              onChange={onPick}
            />
          </div>
        </CardContent>
      </Card>

      {files.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Selected files ({files.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {files.map((f) => (
              <div
                key={f.name}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{f.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {(f.size / 1024 / 1024).toFixed(2)} MB
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeFile(f.name)}
                >
                  Remove
                </Button>
              </div>
            ))}
            <div className="flex justify-end pt-2">
              <Button onClick={submit} disabled={uploading} className="gap-2">
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Importing…
                  </>
                ) : (
                  <>Run import</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import history</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No imports yet.
            </p>
          ) : (
            <div className="space-y-3">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="font-medium">
                        {formatDateTime(h.importedAt)}
                      </span>
                      {h.importedBy && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          by {h.importedBy}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1.5 text-xs">
                      <Badge variant="outline" className="text-[10px]">
                        +{h.result?.created ?? 0} new
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        ~{h.result?.updated ?? 0} updated
                      </Badge>
                      <Badge variant="ghost" className="text-[10px]">
                        ={h.result?.unchanged ?? 0} unchanged
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {h.files.map((f, i) => (
                      <span key={i}>
                        {f.name}{" "}
                        <Badge
                          variant="outline"
                          className="ml-1 text-[10px] font-mono"
                        >
                          {f.type}
                        </Badge>{" "}
                        ({f.rowCount.toLocaleString()} rows)
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
