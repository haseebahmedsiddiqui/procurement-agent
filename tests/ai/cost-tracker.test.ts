import { describe, it, expect, beforeEach } from "vitest";
import {
  recordAICost,
  getCostSummary,
  resetCostTracker,
} from "@/lib/ai/cost-tracker";

describe("AI Cost Tracker", () => {
  beforeEach(() => {
    resetCostTracker();
  });

  it("starts with zero totals", () => {
    const s = getCostSummary();
    expect(s.totalCalls).toBe(0);
    expect(s.totalInputTokens).toBe(0);
    expect(s.totalOutputTokens).toBe(0);
    expect(s.totalEstimatedCostUsd).toBe(0);
  });

  it("records a call and accumulates tokens", () => {
    recordAICost("price_extraction", "claude-haiku-4-5-20251001", {
      input_tokens: 1000,
      output_tokens: 200,
    });
    const s = getCostSummary();
    expect(s.totalCalls).toBe(1);
    expect(s.totalInputTokens).toBe(1000);
    expect(s.totalOutputTokens).toBe(200);
    expect(s.totalEstimatedCostUsd).toBeGreaterThan(0);
  });

  it("groups by call type", () => {
    recordAICost("price_extraction", "claude-haiku-4-5-20251001", {
      input_tokens: 500,
      output_tokens: 100,
    });
    recordAICost("match_evaluation", "claude-sonnet-4-5-20250514", {
      input_tokens: 800,
      output_tokens: 150,
    });
    const s = getCostSummary();
    expect(s.byCallType["price_extraction"].calls).toBe(1);
    expect(s.byCallType["match_evaluation"].calls).toBe(1);
  });

  it("groups by model", () => {
    recordAICost("normalization", "claude-sonnet-4-5-20250514", {
      input_tokens: 1000,
      output_tokens: 500,
    });
    recordAICost("normalization", "claude-sonnet-4-5-20250514", {
      input_tokens: 1000,
      output_tokens: 500,
    });
    const s = getCostSummary();
    expect(s.byModel["claude-sonnet-4-5-20250514"].calls).toBe(2);
    expect(s.byModel["claude-sonnet-4-5-20250514"].inputTokens).toBe(2000);
  });

  it("Haiku is cheaper than Sonnet for same tokens", () => {
    recordAICost("price_extraction", "claude-haiku-4-5-20251001", {
      input_tokens: 10000,
      output_tokens: 1000,
    });
    const haikuCost = getCostSummary().totalEstimatedCostUsd;
    resetCostTracker();

    recordAICost("price_extraction", "claude-sonnet-4-5-20250514", {
      input_tokens: 10000,
      output_tokens: 1000,
    });
    const sonnetCost = getCostSummary().totalEstimatedCostUsd;

    expect(haikuCost).toBeLessThan(sonnetCost);
  });
});
