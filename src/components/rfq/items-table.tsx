"use client";

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
import { ClipboardCheck } from "lucide-react";
import type { NormalizedItem } from "@/lib/ai/item-normalizer";

interface RFQItem {
  lineNumber: number;
  description: string;
  impaCode?: string;
  quantity: number;
  unit: string;
  notes?: string;
}

interface ItemsTableProps {
  items: RFQItem[];
  normalized?: NormalizedItem[];
  vendorSlugs?: string[];
}

export function ItemsTable({ items, normalized, vendorSlugs }: ItemsTableProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="h-4 w-4 text-primary" />
          RFQ Items
          <Badge variant="secondary" className="text-[10px]">{items.length} items</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="w-12">#</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-24">IMPA</TableHead>
                <TableHead className="w-16 text-center">Qty</TableHead>
                <TableHead className="w-16">Unit</TableHead>
                {normalized && (
                  <TableHead>Normalized Name</TableHead>
                )}
                {normalized && vendorSlugs?.map((slug) => (
                  <TableHead key={slug} className="min-w-[140px]">
                    {slug}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, idx) => {
                const norm = normalized?.find((n) => n.index === idx);
                return (
                  <TableRow key={idx} className="group">
                    <TableCell className="text-xs text-muted-foreground">
                      {item.lineNumber}
                    </TableCell>
                    <TableCell className="font-medium text-sm">{item.description}</TableCell>
                    <TableCell>
                      {item.impaCode && (
                        <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                          {item.impaCode}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-center tabular-nums">{item.quantity}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{item.unit}</TableCell>
                    {normalized && (
                      <TableCell className="text-sm text-muted-foreground">
                        {norm?.normalizedName || "—"}
                      </TableCell>
                    )}
                    {normalized && vendorSlugs?.map((slug) => (
                      <TableCell key={slug} className="text-xs text-muted-foreground">
                        {(norm?.searchQueries[slug] as string) || "—"}
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
