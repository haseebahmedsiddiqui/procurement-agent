import { describe, it, expect, beforeEach } from "vitest";
import {
  recordSearch,
  getVendorMetrics,
  getAllVendorMetrics,
  resetVendorMetrics,
} from "@/lib/vendors/metrics";

describe("Vendor Metrics", () => {
  beforeEach(() => {
    resetVendorMetrics();
  });

  it("returns null for unknown vendor", () => {
    expect(getVendorMetrics("nonexistent")).toBeNull();
  });

  it("records a successful search", () => {
    recordSearch("staples", { success: true, source: "http", durationMs: 2000 });
    const m = getVendorMetrics("staples");
    expect(m).not.toBeNull();
    expect(m!.totalSearches).toBe(1);
    expect(m!.successRate).toBe(1);
    expect(m!.avgDurationMs).toBe(2000);
  });

  it("records a cache hit", () => {
    recordSearch("amazon", { success: true, source: "cache", durationMs: 5 });
    const m = getVendorMetrics("amazon")!;
    expect(m.cacheHitRate).toBe(1);
  });

  it("records a dictionary hit", () => {
    recordSearch("grainger", { success: true, source: "dictionary", durationMs: 3 });
    const m = getVendorMetrics("grainger")!;
    expect(m.dictionaryHitRate).toBe(1);
  });

  it("tracks error breakdown", () => {
    recordSearch("mcmaster", { success: false, source: "playwright", durationMs: 8000, errorType: "captcha" });
    recordSearch("mcmaster", { success: false, source: "playwright", durationMs: 9000, errorType: "captcha" });
    recordSearch("mcmaster", { success: false, source: "http", durationMs: 3000, errorType: "blocked" });
    const m = getVendorMetrics("mcmaster")!;
    expect(m.successRate).toBe(0);
    expect(m.errorCounts["captcha"]).toBe(2);
    expect(m.errorCounts["blocked"]).toBe(1);
  });

  it("computes averages correctly", () => {
    recordSearch("staples", { success: true, source: "http", durationMs: 1000 });
    recordSearch("staples", { success: true, source: "http", durationMs: 3000 });
    const m = getVendorMetrics("staples")!;
    expect(m.avgDurationMs).toBe(2000);
    expect(m.successRate).toBe(1);
  });

  it("getAllVendorMetrics returns all tracked vendors", () => {
    recordSearch("a", { success: true, source: "http", durationMs: 100 });
    recordSearch("b", { success: false, source: "http", durationMs: 200, errorType: "error" });
    const all = getAllVendorMetrics();
    expect(Object.keys(all)).toHaveLength(2);
    expect(all["a"].successRate).toBe(1);
    expect(all["b"].successRate).toBe(0);
  });
});
