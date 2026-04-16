"use client";

import { useEffect, useRef, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardCheck, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NormalizedItem } from "@/lib/ai/item-normalizer";

interface RFQItem {
  lineNumber: number;
  description: string;
  impaCode?: string;
  quantity: number;
  unit: string;
  notes?: string;
}

export interface ItemOverride {
  brand?: string;
  partNumber?: string;
}

interface ItemsTableProps {
  items: RFQItem[];
  normalized?: NormalizedItem[];
  vendorSlugs?: string[];
  overrides?: Record<number, ItemOverride>;
  onUpdateOverride?: (
    index: number,
    field: "brand" | "partNumber",
    value: string
  ) => void;
}

function buildOverrideQuery(o?: ItemOverride): string | null {
  if (!o?.partNumber?.trim()) return null;
  return `${o.brand?.trim() ?? ""} ${o.partNumber.trim()}`.trim();
}

function EditableCell({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <input
      ref={ref}
      type="text"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          ref.current?.blur();
        } else if (e.key === "Escape") {
          setDraft(value);
          ref.current?.blur();
        }
      }}
      className="w-full bg-transparent border border-transparent hover:border-input focus:border-primary focus:bg-background rounded px-2 py-1 text-xs font-mono outline-none transition-colors"
    />
  );
}

export function ItemsTable({
  items,
  normalized,
  vendorSlugs,
  overrides,
  onUpdateOverride,
}: ItemsTableProps) {
  const isReviewMode = !!onUpdateOverride;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="h-4 w-4 text-primary" />
          RFQ Items
          <Badge variant="secondary" className="text-[10px]">
            {items.length} items
          </Badge>
        </CardTitle>
        {isReviewMode && (
          <p className="text-xs text-muted-foreground pt-1">
            <Target className="inline h-3 w-3 mr-1 text-primary" />
            Adding a brand + part number for any row overrides the AI query with an
            exact-match search across all vendors. Best for catalog items where you
            already know the SKU.
          </p>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-12">#</TableHead>
                <TableHead className="min-w-[200px]">Description</TableHead>
                <TableHead className="w-24">IMPA</TableHead>
                <TableHead className="w-16 text-center">Qty</TableHead>
                <TableHead className="w-16">Unit</TableHead>
                {isReviewMode && (
                  <>
                    <TableHead className="w-32 text-primary">Brand</TableHead>
                    <TableHead className="w-32 text-primary">Part #</TableHead>
                  </>
                )}
                {normalized && (
                  <TableHead>Normalized Name</TableHead>
                )}
                {normalized &&
                  vendorSlugs?.map((slug) => (
                    <TableHead key={slug} className="min-w-[140px]">
                      {slug}
                    </TableHead>
                  ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, idx) => {
                const norm = normalized?.find((n) => n.index === idx);
                const override = overrides?.[idx];
                const overrideQuery = buildOverrideQuery(override);

                return (
                  <TableRow
                    key={idx}
                    className={cn(
                      "group",
                      overrideQuery && "bg-primary/5"
                    )}
                  >
                    <TableCell className="text-xs text-muted-foreground">
                      {item.lineNumber}
                    </TableCell>
                    <TableCell className="font-medium text-sm">
                      {item.description}
                    </TableCell>
                    <TableCell>
                      {item.impaCode && (
                        <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                          {item.impaCode}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">
                      {item.quantity}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {item.unit}
                    </TableCell>
                    {isReviewMode && (
                      <>
                        <TableCell className="p-1">
                          <EditableCell
                            value={override?.brand ?? ""}
                            placeholder="e.g. 3M"
                            onCommit={(v) =>
                              onUpdateOverride!(idx, "brand", v)
                            }
                          />
                        </TableCell>
                        <TableCell className="p-1">
                          <EditableCell
                            value={override?.partNumber ?? ""}
                            placeholder="e.g. 8210"
                            onCommit={(v) =>
                              onUpdateOverride!(idx, "partNumber", v)
                            }
                          />
                        </TableCell>
                      </>
                    )}
                    {normalized && (
                      <TableCell className="text-sm text-muted-foreground">
                        {norm?.normalizedName || "—"}
                      </TableCell>
                    )}
                    {normalized &&
                      vendorSlugs?.map((slug) => (
                        <TableCell
                          key={slug}
                          className={cn(
                            "text-xs",
                            overrideQuery
                              ? "text-primary font-medium"
                              : "text-muted-foreground"
                          )}
                        >
                          {overrideQuery ? (
                            <span className="inline-flex items-center gap-1">
                              <Target className="h-3 w-3" />
                              {overrideQuery}
                            </span>
                          ) : (
                            (norm?.searchQueries[slug] as string) || "—"
                          )}
                        </TableCell>
                      ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
