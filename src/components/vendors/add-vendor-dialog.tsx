"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CATEGORY_OPTIONS = [
  { value: "stationery", label: "Stationery" },
  { value: "deck_engine", label: "Deck / Engine" },
  { value: "galley_kitchen", label: "Galley / Kitchen" },
];

interface AddVendorDialogProps {
  onCreated?: () => void;
}

export function AddVendorDialog({ onCreated }: AddVendorDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [searchUrlPattern, setSearchUrlPattern] = useState("");
  const [category, setCategory] = useState("stationery");
  const [extractionHints, setExtractionHints] = useState("");

  const reset = () => {
    setName("");
    setBaseUrl("");
    setSearchUrlPattern("");
    setCategory("stationery");
    setExtractionHints("");
  };

  const canSubmit =
    name.trim().length >= 2 &&
    baseUrl.trim().length > 0 &&
    searchUrlPattern.includes("{{query}}");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          category,
          baseUrl: baseUrl.trim(),
          searchUrlPattern: searchUrlPattern.trim(),
          extractionHints: extractionHints.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Create failed");
      }
      toast.success(`Added vendor "${data.vendor.name}"`);
      reset();
      setOpen(false);
      onCreated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        Add Custom Store
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Custom Store</DialogTitle>
          <DialogDescription>
            Register a new vendor. The generic HTTP+LLM adapter handles most
            stores with public pricing automatically.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="store-name">Store Name</Label>
            <Input
              id="store-name"
              placeholder="e.g., Marine Supply Co"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="store-url">Website URL</Label>
            <Input
              id="store-url"
              type="url"
              placeholder="https://www.example.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              disabled={submitting}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="search-url">Search URL Pattern</Label>
            <Input
              id="search-url"
              placeholder="https://www.example.com/search?q={{query}}"
              value={searchUrlPattern}
              onChange={(e) => setSearchUrlPattern(e.target.value)}
              disabled={submitting}
              required
            />
            <p className="text-xs text-muted-foreground">
              Use {"{{query}}"} where the search term goes.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <select
              id="category"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={submitting}
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="hints">Extraction Hints (optional)</Label>
            <Input
              id="hints"
              placeholder="e.g., 'prices shown per unit; SKUs are 6-digit codes'"
              value={extractionHints}
              onChange={(e) => setExtractionHints(e.target.value)}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              Hints passed to the AI extractor to improve accuracy.
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={!canSubmit || submitting}>
            {submitting ? "Adding…" : "Add Store"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
