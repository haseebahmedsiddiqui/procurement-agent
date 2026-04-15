/**
 * In-memory AI API cost tracker.
 *
 * Records token usage per call type (category detection, normalization,
 * price extraction, match evaluation) and computes estimated costs
 * using published per-token pricing.
 *
 * Pricing as of 2025 (USD per 1M tokens):
 *   Haiku:  input $0.25, output $1.25
 *   Sonnet: input $3.00, output $15.00
 */

export type CallType =
  | "category_detection"
  | "normalization"
  | "price_extraction"
  | "match_evaluation";

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

interface CostEntry {
  callType: CallType;
  model: string;
  usage: TokenUsage;
  estimatedCostUsd: number;
  timestamp: number;
}

// Per-1M-token pricing
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 0.25, output: 1.25 },
  "claude-sonnet-4-5-20250514": { input: 3.0, output: 15.0 },
};

const DEFAULT_PRICING = { input: 3.0, output: 15.0 }; // Assume Sonnet if unknown

function estimateCost(model: string, usage: TokenUsage): number {
  const pricing = PRICING[model] ?? DEFAULT_PRICING;
  return (
    (usage.inputTokens * pricing.input) / 1_000_000 +
    (usage.outputTokens * pricing.output) / 1_000_000
  );
}

const entries: CostEntry[] = [];
const MAX_ENTRIES = 10_000; // Ring buffer to cap memory

export function recordAICost(
  callType: CallType,
  model: string,
  usage: { input_tokens: number; output_tokens: number }
): void {
  const tokenUsage: TokenUsage = {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
  };
  const cost = estimateCost(model, tokenUsage);
  entries.push({
    callType,
    model,
    usage: tokenUsage,
    estimatedCostUsd: cost,
    timestamp: Date.now(),
  });
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

export interface CostSummary {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCostUsd: number;
  byCallType: Record<
    string,
    {
      calls: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
    }
  >;
  byModel: Record<
    string,
    {
      calls: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
    }
  >;
}

export function getCostSummary(): CostSummary {
  const summary: CostSummary = {
    totalCalls: entries.length,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalEstimatedCostUsd: 0,
    byCallType: {},
    byModel: {},
  };

  for (const e of entries) {
    summary.totalInputTokens += e.usage.inputTokens;
    summary.totalOutputTokens += e.usage.outputTokens;
    summary.totalEstimatedCostUsd += e.estimatedCostUsd;

    // By call type
    if (!summary.byCallType[e.callType]) {
      summary.byCallType[e.callType] = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    }
    const ct = summary.byCallType[e.callType];
    ct.calls++;
    ct.inputTokens += e.usage.inputTokens;
    ct.outputTokens += e.usage.outputTokens;
    ct.costUsd += e.estimatedCostUsd;

    // By model
    if (!summary.byModel[e.model]) {
      summary.byModel[e.model] = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    }
    const bm = summary.byModel[e.model];
    bm.calls++;
    bm.inputTokens += e.usage.inputTokens;
    bm.outputTokens += e.usage.outputTokens;
    bm.costUsd += e.estimatedCostUsd;
  }

  // Round costs
  summary.totalEstimatedCostUsd = Math.round(summary.totalEstimatedCostUsd * 10000) / 10000;
  for (const v of Object.values(summary.byCallType)) {
    v.costUsd = Math.round(v.costUsd * 10000) / 10000;
  }
  for (const v of Object.values(summary.byModel)) {
    v.costUsd = Math.round(v.costUsd * 10000) / 10000;
  }

  return summary;
}

export function resetCostTracker(): void {
  entries.length = 0;
}
