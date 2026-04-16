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
import { ClipboardCheck, Target, Pencil } from "lucide-react";
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
  searchQueryOverrides?: Record<string, string>;
  onUpdateSearchQuery?: (
    itemIndex: number,
    vendorSlug: string,
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
      className="w-full bg-transparent border border-transparent hover:border-input focus:border-primary focus:bg-background rounded-md px-2 py-1.5 text-xs font-mono outline-none transition-all duration-200"
    />
  );
}

export function ItemsTable({
  items,
  normalized,
  vendorSlugs,
  overrides,
  onUpdateOverride,
  searchQueryOverrides,
  onUpdateSearchQuery,
}: ItemsTableProps) {
  const isReviewMode = !!onUpdateOverride;

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <ClipboardCheck className="h-4 w-4 text-primary" />
          </div>
          RFQ Items
          <Badge variant="secondary" className="text-[10px] rounded-md">
            {items.length} items
          </Badge>
        </CardTitle>
        {isReviewMode && (
          <p className="text-xs text-muted-foreground pt-1.5 flex items-center gap-1.5">
            <Pencil className="inline h-3 w-3 text-primary" />
            Click any search query to edit it before searching. Adding a brand + part
            number overrides all vendor queries with an exact-match search.
          </p>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-12 text-xs font-semibold">#</TableHead>
                <TableHead className="min-w-[200px] text-xs font-semibold">Description</TableHead>
                <TableHead className="w-24 text-xs font-semibold">IMPA</TableHead>
                <TableHead className="w-16 text-center text-xs font-semibold">Qty</TableHead>
                <TableHead className="w-16 text-xs font-semibold">Unit</TableHead>
                {isReviewMode && (
                  <>
                    <TableHead className="w-32 text-xs font-semibold text-primary">Brand</TableHead>
                    <TableHead className="w-32 text-xs font-semibold text-primary">Part #</TableHead>
                  </>
                )}
                {normalized && (
                  <TableHead className="text-xs font-semibold">Normalized Name</TableHead>
                )}
                {normalized &&
                  vendorSlugs?.map((slug) => (
                    <TableHead key={slug} className="min-w-[140px] text-xs font-semibold">
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
                      "group transition-colors",
                      overrideQuery && "bg-primary/[0.03]"
                    )}
                  >
                    <TableCell className="text-xs text-muted-foreground font-mono tabular-nums">
                      {item.lineNumber}
                    </TableCell>
                    <TableCell className="font-medium text-sm">
                      {item.description}
                    </TableCell>
                    <TableCell>
                      {item.impaCode && (
                        <span className="font-mono text-[10px] bg-muted/60 px-2 py-0.5 rounded-md text-muted-foreground">
                          {item.impaCode}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-center tabular-nums font-mono text-sm">
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
                      vendorSlugs?.map((slug) => {
                        const aiQuery = (norm?.searchQueries[slug] as string) || "";
                        const overrideKey = `${idx}::${slug}`;
                        const editedQuery = searchQueryOverrides?.[overrideKey];
                        const displayQuery = overrideQuery || editedQuery || aiQuery;

                        return (
                          <TableCell
                            key={slug}
                            className={cn(
                              "text-xs p-1",
                              overrideQuery
                                ? "text-primary font-medium"
                                : editedQuery
                                  ? "text-amber-700"
                                  : "text-muted-foreground"
                            )}
                          >
                            {overrideQuery ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1">
                                <Target className="h-3 w-3" />
                                {overrideQuery}
                              </span>
                            ) : isReviewMode && onUpdateSearchQuery ? (
                              <EditableCell
                                value={editedQuery || aiQuery}
                                placeholder={aiQuery || "search query"}
                                onCommit={(v) => {
                                  if (v.trim() === aiQuery.trim()) {
                                    onUpdateSearchQuery(idx, slug, "");
                                  } else {
                                    onUpdateSearchQuery(idx, slug, v);
                                  }
                                }}
                              />
                            ) : (
                              displayQuery || "—"
                            )}
                          </TableCell>
                        );
                      })}
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
