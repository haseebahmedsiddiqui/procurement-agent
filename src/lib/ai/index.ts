export { getAIClient, MODELS } from "./client";
export { detectCategory, type DetectionResult, type CategoryGroup } from "./category-detector";
export { normalizeItems, type NormalizedItem } from "./item-normalizer";
export { extractPricesFromHtml, type ExtractedProduct } from "./price-extractor";
export { evaluateMatch, type MatchEvaluation } from "./match-evaluator";
