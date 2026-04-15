"use client";

import { useCallback, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, FileSpreadsheet, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileUploadProps {
  onUploadComplete: (data: UploadResult) => void;
}

export interface UploadResult {
  rfqId: string;
  filename: string;
  format: string;
  totalItems: number;
  items: Array<{
    lineNumber: number;
    description: string;
    impaCode?: string;
    quantity: number;
    unit: string;
    notes?: string;
  }>;
  warnings: string[];
  detection: {
    primaryCategory: string;
    isMixed: boolean;
    overallConfidence: number;
    groups: Array<{
      category: "stationery" | "deck_engine" | "galley_kitchen";
      confidence: number;
      itemIndices: number[];
      reasoning: string;
    }>;
  };
}

export function FileUpload({ onUploadComplete }: FileUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
        setError("Only Excel files (.xlsx, .xls) are supported");
        return;
      }

      setUploading(true);
      setError(null);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Upload failed");
        }

        onUploadComplete(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [onUploadComplete]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div
          className={cn(
            "relative flex flex-col items-center justify-center py-16 px-6 transition-all duration-200 cursor-pointer",
            "border-2 border-dashed rounded-[inherit] m-3",
            dragActive
              ? "border-primary bg-primary/5 scale-[1.01]"
              : "border-border hover:border-primary/40 hover:bg-accent/50",
            uploading && "pointer-events-none opacity-70"
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => {
            if (!uploading) {
              document.getElementById("rfq-file-input")?.click();
            }
          }}
        >
          {uploading ? (
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                  <Loader2 className="h-8 w-8 text-primary animate-spin" />
                </div>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">Processing RFQ...</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Parsing Excel and detecting category
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className={cn(
                "flex h-16 w-16 items-center justify-center rounded-2xl transition-colors",
                dragActive ? "bg-primary/15" : "bg-primary/10"
              )}>
                {dragActive ? (
                  <FileSpreadsheet className="h-8 w-8 text-primary" />
                ) : (
                  <Upload className="h-8 w-8 text-primary" />
                )}
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">
                  {dragActive ? "Drop your file here" : "Drag & drop your RFQ file"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Supports Excel (.xlsx) files — AI will detect category and suggest vendors
                </p>
              </div>
              <label className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                <span className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90">
                  Browse Files
                </span>
                <input
                  id="rfq-file-input"
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={handleInputChange}
                />
              </label>
            </div>
          )}
        </div>

        {error && (
          <div className="mx-3 mb-3 rounded-lg bg-destructive/10 border border-destructive/20 p-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
