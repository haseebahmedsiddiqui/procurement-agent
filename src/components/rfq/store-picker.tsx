"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Store, Globe, Lock, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface CategoryGroup {
  category: "stationery" | "deck_engine" | "galley_kitchen";
  confidence: number;
  itemIndices: number[];
  reasoning: string;
}

interface Vendor {
  slug: string;
  name: string;
  category: string;
  authRequired: boolean;
  preferredStrategy: string;
}

interface CategoryInfo {
  slug: string;
  name: string;
  icon: string;
  defaultVendors: string[];
}

interface StorePickerProps {
  groups: CategoryGroup[];
  isMixed: boolean;
  vendors: Vendor[];
  categories: CategoryInfo[];
  onSelectionChange: (selection: Record<string, string[]>) => void;
  onConfirm: (selection: Record<string, string[]>) => void;
}

const confidenceColor = (c: number) => {
  if (c >= 0.8) return "bg-emerald-500/15 text-emerald-700";
  if (c >= 0.5) return "bg-amber-500/15 text-amber-700";
  return "bg-red-500/15 text-red-700";
};

const STORAGE_KEY = "procurement-agent:store-picker-v1";

function loadStoredSelection(): Record<string, string[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveStoredSelection(selection: Record<string, string[]>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // localStorage may be disabled — non-critical
  }
}

const STRATEGY_LABELS: Record<string, { label: string; color: string }> = {
  api: { label: "API", color: "bg-blue-500/15 text-blue-700" },
  scrape: { label: "Scrape", color: "bg-amber-500/15 text-amber-700" },
  playwright: { label: "Browser", color: "bg-purple-500/15 text-purple-700" },
};

export function StorePicker({
  groups,
  isMixed,
  vendors,
  categories,
  onSelectionChange,
  onConfirm,
}: StorePickerProps) {
  const [selected, setSelected] = useState<Record<string, string[]>>(() => {
    const stored = loadStoredSelection();
    const init: Record<string, string[]> = {};
    for (const group of groups) {
      const catInfo = categories.find((c) => c.slug === group.category);
      const catVendors = vendors
        .filter((v) => v.category === group.category)
        .map((v) => v.slug);

      const remembered = stored[group.category];
      if (remembered && Array.isArray(remembered)) {
        const filtered = remembered.filter((s) => catVendors.includes(s));
        init[group.category] = filtered.length > 0 ? filtered : (
          catInfo
            ? catVendors.filter((s) => catInfo.defaultVendors.includes(s))
            : catVendors
        );
      } else {
        init[group.category] = catInfo
          ? catVendors.filter((s) => catInfo.defaultVendors.includes(s))
          : catVendors;
      }
    }
    return init;
  });

  useEffect(() => {
    onSelectionChange(selected);
    saveStoredSelection(selected);
  }, [selected, onSelectionChange]);

  const toggleVendor = (category: string, vendorSlug: string) => {
    setSelected((prev) => {
      const current = prev[category] || [];
      const next = current.includes(vendorSlug)
        ? current.filter((s) => s !== vendorSlug)
        : [...current, vendorSlug];
      return { ...prev, [category]: next };
    });
  };

  const selectAll = (category: string) => {
    const catVendors = vendors
      .filter((v) => v.category === category)
      .map((v) => v.slug);
    setSelected((prev) => ({ ...prev, [category]: catVendors }));
  };

  const selectNone = (category: string) => {
    setSelected((prev) => ({ ...prev, [category]: [] }));
  };

  const renderCategoryPicker = (group: CategoryGroup) => {
    const catInfo = categories.find((c) => c.slug === group.category);
    const catVendors = vendors.filter((v) => v.category === group.category);
    const selectedForCat = selected[group.category] || [];

    return (
      <div key={group.category} className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">{catInfo?.icon}</span>
            <span className="font-medium">{catInfo?.name}</span>
            <Badge className={cn("text-[10px]", confidenceColor(group.confidence))}>
              {Math.round(group.confidence * 100)}% confidence
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {group.itemIndices.length} items
            </Badge>
          </div>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => selectAll(group.category)}
            >
              All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => selectNone(group.category)}
            >
              None
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{group.reasoning}</p>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {catVendors.map((vendor) => {
            const isSelected = selectedForCat.includes(vendor.slug);
            const strategy = STRATEGY_LABELS[vendor.preferredStrategy] || {
              label: vendor.preferredStrategy.toUpperCase(),
              color: "bg-muted text-muted-foreground",
            };

            return (
              <div
                key={vendor.slug}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-all duration-150",
                  isSelected
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "hover:bg-accent/50 hover:border-border"
                )}
                onClick={() => toggleVendor(group.category, vendor.slug)}
              >
                <Checkbox
                  checked={isSelected}
                  onClick={(e) => e.stopPropagation()}
                  onCheckedChange={() =>
                    toggleVendor(group.category, vendor.slug)
                  }
                />
                <div className="flex-1 min-w-0">
                  <Label className="cursor-pointer font-medium text-sm">
                    {vendor.name}
                  </Label>
                  <div className="flex items-center gap-1 mt-1">
                    <Badge className={cn("text-[10px] h-4 px-1.5", strategy.color)}>
                      {strategy.label}
                    </Badge>
                    {vendor.authRequired ? (
                      <Badge variant="outline" className="text-[10px] h-4 px-1.5 gap-0.5">
                        <Lock className="h-2.5 w-2.5" />
                        Auth
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] h-4 px-1.5 gap-0.5">
                        <Globe className="h-2.5 w-2.5" />
                        Open
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const totalSelected = Object.values(selected).flat().length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Store className="h-4 w-4 text-primary" />
          Select Stores
          {isMixed && (
            <Badge variant="secondary" className="text-[10px]">Mixed RFQ</Badge>
          )}
        </CardTitle>
        <CardDescription>
          {isMixed
            ? "This RFQ spans multiple categories. Select stores for each group."
            : "Choose which stores to search for price comparison."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isMixed && groups.length > 1 ? (
          <Tabs defaultValue={groups[0].category}>
            <TabsList>
              {groups.map((g) => {
                const catInfo = categories.find((c) => c.slug === g.category);
                return (
                  <TabsTrigger key={g.category} value={g.category}>
                    {catInfo?.icon} {catInfo?.name} ({g.itemIndices.length})
                  </TabsTrigger>
                );
              })}
            </TabsList>
            {groups.map((group) => (
              <TabsContent key={group.category} value={group.category}>
                {renderCategoryPicker(group)}
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          groups.map((group) => renderCategoryPicker(group))
        )}

        <div className="flex items-center justify-between border-t pt-4">
          <p className="text-sm text-muted-foreground">
            {totalSelected} store{totalSelected !== 1 ? "s" : ""} selected
          </p>
          <Button
            onClick={() => onConfirm(selected)}
            disabled={totalSelected === 0}
            className="gap-1.5"
          >
            Continue
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
