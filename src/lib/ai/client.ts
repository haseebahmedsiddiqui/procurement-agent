import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function getAIClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return client;
}

// Model selection per task (cost optimization)
export const MODELS = {
  // Complex reasoning: category detection, match evaluation, normalization
  reasoning: "claude-sonnet-4-6" as const,
  // Simple extraction: price extraction, data parsing
  extraction: "claude-haiku-4-5-20251001" as const,
};
