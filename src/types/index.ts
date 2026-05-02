// ==========================================
// Procurement Agent — Core Type Definitions
// ==========================================

export type VendorCategory = "stationery" | "deck_engine" | "galley_kitchen";

export type VendorStrategy = "http" | "playwright";

export type AuthType = "playwright" | "none";

export type HealthStatus = "healthy" | "degraded" | "down";

export type MatchConfidence = number; // 0.0 - 1.0

export interface VendorConfig {
  name: string;
  slug: string;
  category: VendorCategory;
  enabled: boolean;
  baseUrl: string;
  searchUrlPattern: string;
  authRequired: boolean;
  authType: AuthType;
  loginUrl?: string;
  dashboardUrl?: string;
  sessionMaxAgeHours: number;
  preferredStrategy: VendorStrategy;
  needsJsRendering: boolean;
  rateLimitMs: number;
  extractionHints: string;
  searchQueryTemplate: string;
  createdAt: Date;
  lastHealthCheck?: Date;
  healthStatus: HealthStatus;
}

export interface Category {
  slug: VendorCategory;
  name: string;
  description: string;
  icon: string;
  defaultVendors: string[];
  detectionKeywords: string[];
}

export interface VendorMapping {
  productId: string;
  productIdType: string;
  searchQuery: string;
  productUrl: string;
  verified: boolean;
  verifiedAt: Date | null;
}

export interface Item {
  rfqDescription: string;
  normalizedName: string;
  impaCode?: string;
  category: VendorCategory;
  vendors: Record<string, VendorMapping>;
}

export interface Price {
  itemId: string;
  vendorSlug: string;
  price: number;
  currency: string;
  pricePerUnit?: number;
  url: string;
  inStock: boolean;
  deliveryEstimate?: string;
  scrapedAt: Date;
}

export interface RFQItem {
  lineNumber: number;
  description: string;
  impaCode?: string;
  quantity: number;
  unit: string;
  notes?: string;
}

export interface RFQDocument {
  filename: string;
  uploadedAt: Date;
  items: RFQItem[];
  detectedCategory: VendorCategory | "mixed";
  categoryConfidence: number;
  selectedVendors: string[];
  status: "uploaded" | "processing" | "completed" | "failed";
}

export interface SearchResult {
  vendorSlug: string;
  productName: string;
  productId: string;
  productUrl: string;
  price: number;
  currency: string;
  inStock: boolean;
  deliveryEstimate?: string;
  reviewCount?: number;
  starRating?: number;
  confidence: MatchConfidence;
  reasoning: string;
}

export interface MatchFeedback {
  itemId: string;
  vendorSlug: string;
  originalMatch: SearchResult;
  action: "confirmed" | "rejected" | "corrected";
  correctedProductId?: string;
  correctedProductUrl?: string;
  createdAt: Date;
}
