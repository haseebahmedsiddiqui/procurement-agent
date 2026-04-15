import { connectDB } from "@/lib/db/connection";
import { Vendor } from "@/lib/db/models/Vendor";
import { BaseVendorAdapter, type VendorConfig } from "./base-adapter";
import { AmazonAdapter } from "./adapters/amazon";
import { StaplesAdapter } from "./adapters/staples";
import { OfficeBasicsAdapter } from "./adapters/officebasics";
import { OfficeDepotAdapter } from "./adapters/officedepot";
import { McMasterAdapter } from "./adapters/mcmaster";
import { GraingerAdapter } from "./adapters/grainger";
import { WebstaurantAdapter } from "./adapters/webstaurant";
import { EquippersAdapter } from "./adapters/equippers";
import { GenericAdapter } from "./adapters/generic";
import { logger } from "@/lib/logger";

// Maps vendor slugs to hand-written adapter classes. Any vendor not listed
// here gets the GenericAdapter as a fallback (used by user-added stores).
const ADAPTER_MAP: Record<string, new (config: VendorConfig) => BaseVendorAdapter> = {
  // Stationery
  amazon: AmazonAdapter,
  staples: StaplesAdapter,
  officebasics: OfficeBasicsAdapter,
  officedepot: OfficeDepotAdapter,
  // Deck / Engine
  "amazon-deck": AmazonAdapter,
  mcmaster: McMasterAdapter,
  grainger: GraingerAdapter,
  // Galley / Kitchen
  "amazon-galley": AmazonAdapter,
  webstaurant: WebstaurantAdapter,
  equippers: EquippersAdapter,
};

// Cache adapters to avoid re-creating
const adapterCache = new Map<string, BaseVendorAdapter>();

/**
 * Get an adapter for a vendor by slug.
 * Reads vendor config from DB and creates the appropriate adapter.
 */
export async function getAdapter(vendorSlug: string): Promise<BaseVendorAdapter> {
  if (adapterCache.has(vendorSlug)) {
    return adapterCache.get(vendorSlug)!;
  }

  await connectDB();
  const vendor = await Vendor.findOne({ slug: vendorSlug, enabled: true }).lean();

  if (!vendor) {
    throw new Error(`Vendor not found or disabled: ${vendorSlug}`);
  }

  const config: VendorConfig = {
    slug: vendor.slug,
    name: vendor.name,
    category: vendor.category,
    baseUrl: vendor.baseUrl,
    searchUrlPattern: vendor.searchUrlPattern,
    preferredStrategy: vendor.preferredStrategy as "http" | "playwright",
    needsJsRendering: vendor.needsJsRendering,
    rateLimitMs: vendor.rateLimitMs,
    extractionHints: vendor.extractionHints || "",
    searchQueryTemplate: vendor.searchQueryTemplate || "",
    authRequired: vendor.authRequired,
    sessionMaxAgeHours: vendor.sessionMaxAgeHours,
    cacheFreshnessHours: vendor.cacheFreshnessHours ?? 24,
  };

  const AdapterClass = ADAPTER_MAP[vendorSlug] ?? GenericAdapter;
  const adapter = new AdapterClass(config);
  adapterCache.set(vendorSlug, adapter);

  logger.info(
    {
      vendor: vendorSlug,
      adapter: AdapterClass === GenericAdapter ? "generic" : vendorSlug,
    },
    "Adapter created"
  );
  return adapter;
}

/**
 * Check if a vendor has an adapter available. Always true now that the
 * GenericAdapter handles any vendor without a hand-written one.
 */
export function hasAdapter(_vendorSlug: string): boolean {
  return true;
}

/**
 * Get list of vendors with available adapters.
 */
export function getAvailableAdapters(): string[] {
  return Object.keys(ADAPTER_MAP);
}

/**
 * Clear adapter cache (useful for testing or config changes).
 */
export function clearAdapterCache(): void {
  adapterCache.clear();
}
