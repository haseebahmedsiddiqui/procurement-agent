import { connectDB } from "@/lib/db/connection";
import { Item } from "@/lib/db/models/Item";
import { Price } from "@/lib/db/models/Price";
import { extractPricesFromHtml } from "@/lib/ai/price-extractor";
import { evaluateMatch } from "@/lib/ai/match-evaluator";
import { logger } from "@/lib/logger";
import type { Types } from "mongoose";

export interface SearchInput {
  rfqDescription: string;
  normalizedName: string;
  searchQuery: string;
  impaCode?: string;
  quantity: number;
  unit: string;
}

export interface VendorSearchResult {
  vendorSlug: string;
  productName: string;
  productId: string;
  productUrl: string;
  price: number;
  currency: string;
  pricePerUnit?: number;
  inStock: boolean;
  deliveryEstimate?: string;
  imageUrl?: string;
  rawHtml?: string; // For debugging
}

export type SearchErrorType =
  | "captcha"
  | "auth_expired"
  | "blocked"
  | "no_results"
  | "timeout"
  | "error";

export interface SearchOutcome {
  input: SearchInput;
  result: VendorSearchResult | null;
  source: "dictionary" | "cache" | "http" | "playwright";
  durationMs: number;
  error?: string;
  errorType?: SearchErrorType;
}

export interface VendorConfig {
  slug: string;
  name: string;
  category: string;
  baseUrl: string;
  searchUrlPattern: string;
  preferredStrategy: "http" | "playwright";
  needsJsRendering: boolean;
  rateLimitMs: number;
  extractionHints: string;
  searchQueryTemplate: string;
  authRequired: boolean;
  sessionMaxAgeHours: number;
  /** How long a scraped price remains valid before re-scraping. */
  cacheFreshnessHours: number;
}

/**
 * Base class for all vendor adapters.
 *
 * Uses a multi-layer strategy:
 *   Layer 1   : Product Dictionary lookup (0ms, free) — known vendor URL
 *   Layer 1.5 : Price cache (0ms, free) — recent scraped price within TTL
 *   Layer 2   : HTTP fetch + LLM extraction (2s, ~$0.01)
 *   Layer 3   : Playwright fetch + LLM extraction (5s, ~$0.01)
 *
 * Subclasses override specific methods for vendor-specific behavior.
 */
export abstract class BaseVendorAdapter {
  protected config: VendorConfig;
  private lastRequestTime = 0;

  /**
   * Adapters set this from fetchHttp/fetchPlaywright when they detect a
   * specific failure condition (CAPTCHA, blocked, auth expired, etc.).
   * The base search() method propagates it into the SearchOutcome.
   */
  protected lastErrorType?: SearchErrorType;
  protected lastErrorMessage?: string;

  constructor(config: VendorConfig) {
    this.config = config;
  }

  /**
   * Main search method — runs the multi-layer strategy:
   *   Layer 1   : Product Dictionary (verified vendor mapping → URL)
   *   Layer 1.5 : Fresh price cache (skip scraping if price is still valid)
   *   Layer 2   : HTTP fetch + LLM extraction
   *   Layer 3   : Playwright fetch + LLM extraction
   * Successful Layer 2/3 results are written back to the price cache when
   * we have an itemId so future calls can short-circuit at Layer 1.5.
   */
  async search(input: SearchInput): Promise<SearchOutcome> {
    const start = Date.now();
    this.lastErrorType = undefined;
    this.lastErrorMessage = undefined;

    // Find item up front so dictionary + cache layers can both use it
    const item = await this.findItem(input);
    const itemId = item?._id as Types.ObjectId | undefined;

    // Layer 1.5: Fresh price cache (only meaningful if we have an itemId)
    if (itemId) {
      const cached = await this.lookupPriceCache(itemId);
      if (cached) {
        return {
          input,
          result: cached,
          source: "cache",
          durationMs: Date.now() - start,
        };
      }
    }

    // Layer 1: Build dictionary URL fallback (used only if scraping fails)
    const dictResult = item ? this.dictionaryResult(item) : null;

    // Layer 2: HTTP fetch
    let scraped: VendorSearchResult | null = null;
    let scrapedSource: "http" | "playwright" = "http";
    if (this.config.preferredStrategy === "http" || !this.config.needsJsRendering) {
      try {
        await this.rateLimit();
        const html = await this.fetchHttp(input);
        if (html) {
          scraped = await this.extractFromHtml(html, input);
        }
      } catch (err) {
        logger.warn(
          { vendor: this.config.slug, error: err },
          "HTTP fetch failed, trying Playwright"
        );
      }
    }

    // Layer 3: Playwright fallback
    if (!scraped) {
      try {
        await this.rateLimit();
        const html = await this.fetchPlaywright(input);
        if (html) {
          scraped = await this.extractFromHtml(html, input);
          scrapedSource = "playwright";
        }
      } catch (err) {
        logger.error(
          { vendor: this.config.slug, error: err },
          "Playwright fetch also failed"
        );
        return {
          input,
          result: null,
          source: "playwright",
          durationMs: Date.now() - start,
          error: err instanceof Error ? err.message : "Search failed",
          errorType: this.lastErrorType ?? "error",
        };
      }
    }

    if (scraped) {
      // Write-through to price cache (if we have an itemId to anchor to)
      if (itemId) {
        await this.savePriceCache(itemId, scraped).catch((err) =>
          logger.warn({ vendor: this.config.slug, error: err }, "Price cache write failed")
        );
      }
      return {
        input,
        result: scraped,
        source: scrapedSource,
        durationMs: Date.now() - start,
      };
    }

    // Fall back to dictionary URL with no fresh price (rare — dictionary hit but scrape failed)
    if (dictResult) {
      return {
        input,
        result: dictResult,
        source: "dictionary",
        durationMs: Date.now() - start,
      };
    }

    return {
      input,
      result: null,
      source: scrapedSource,
      durationMs: Date.now() - start,
      error: this.lastErrorMessage ?? "No results from any strategy",
      errorType: this.lastErrorType ?? "no_results",
    };
  }

  /**
   * Build the search URL for this vendor.
   */
  buildSearchUrl(query: string): string {
    return this.config.searchUrlPattern.replace(
      "{{query}}",
      encodeURIComponent(query)
    );
  }

  /**
   * Find a matching Item in the Product Dictionary by normalizedName /
   * rfqDescription / IMPA code. Returns the raw item document so callers
   * can inspect the verified vendor mapping AND look up prices by itemId.
   */
  protected async findItem(input: SearchInput): Promise<Record<string, unknown> | null> {
    try {
      await connectDB();
      const item = await Item.findOne({
        $or: [
          { normalizedName: input.normalizedName },
          { rfqDescription: input.rfqDescription },
          ...(input.impaCode ? [{ impaCode: input.impaCode }] : []),
        ],
      }).lean();
      return item as Record<string, unknown> | null;
    } catch {
      return null;
    }
  }

  /**
   * Layer 1: Build a dictionary result from a known item if it has a verified
   * vendor mapping for this adapter's vendor.
   */
  protected dictionaryResult(
    item: Record<string, unknown>
  ): VendorSearchResult | null {
    const vendors = item.vendors as
      | Map<string, Record<string, unknown>>
      | Record<string, Record<string, unknown>>
      | undefined;
    if (!vendors) return null;

    // Mongoose .lean() returns a plain object, not a Map
    const vendorData =
      vendors instanceof Map
        ? vendors.get(this.config.slug)
        : vendors[this.config.slug];
    if (!vendorData || !vendorData.verified) return null;

    logger.info(
      { vendor: this.config.slug, item: item.normalizedName },
      "Dictionary hit (URL only — price still needs fresh fetch)"
    );

    return {
      vendorSlug: this.config.slug,
      productName: (item.normalizedName as string) || "",
      productId: vendorData.productId as string,
      productUrl: vendorData.productUrl as string,
      price: 0, // Price will be fetched fresh
      currency: "USD",
      inStock: true,
    };
  }

  /**
   * Layer 1.5: Check the Price collection for a recent scrape.
   * Returns a result if a price exists within `cacheFreshnessHours`.
   */
  protected async lookupPriceCache(
    itemId: Types.ObjectId
  ): Promise<VendorSearchResult | null> {
    try {
      await connectDB();
      const recent = await Price.findOne({
        itemId,
        vendorSlug: this.config.slug,
      })
        .sort({ scrapedAt: -1 })
        .lean();

      if (!recent) return null;

      const ageMs = Date.now() - new Date(recent.scrapedAt).getTime();
      const maxAgeMs = this.config.cacheFreshnessHours * 3600 * 1000;
      if (ageMs > maxAgeMs) {
        logger.debug(
          {
            vendor: this.config.slug,
            ageHours: (ageMs / 3600000).toFixed(1),
            maxHours: this.config.cacheFreshnessHours,
          },
          "Price cache stale"
        );
        return null;
      }

      logger.info(
        {
          vendor: this.config.slug,
          ageMin: (ageMs / 60000).toFixed(1),
          price: recent.price,
        },
        "Price cache hit"
      );

      return {
        vendorSlug: this.config.slug,
        productName: "",
        productId: "",
        productUrl: recent.url,
        price: recent.price,
        currency: recent.currency || "USD",
        pricePerUnit: recent.pricePerUnit ?? undefined,
        inStock: recent.inStock ?? true,
        deliveryEstimate: recent.deliveryEstimate ?? undefined,
      };
    } catch (err) {
      logger.warn(
        { vendor: this.config.slug, error: err },
        "Price cache lookup failed"
      );
      return null;
    }
  }

  /**
   * Write a freshly scraped price into the Price collection so the next
   * lookup within `cacheFreshnessHours` can short-circuit at Layer 1.5.
   */
  protected async savePriceCache(
    itemId: Types.ObjectId,
    result: VendorSearchResult
  ): Promise<void> {
    await connectDB();
    await Price.create({
      itemId,
      vendorSlug: this.config.slug,
      price: result.price,
      currency: result.currency,
      pricePerUnit: result.pricePerUnit,
      url: result.productUrl,
      inStock: result.inStock,
      deliveryEstimate: result.deliveryEstimate,
      scrapedAt: new Date(),
    });
  }

  /**
   * Layer 2: HTTP fetch (subclasses may override).
   */
  protected abstract fetchHttp(input: SearchInput): Promise<string | null>;

  /**
   * Layer 3: Playwright fetch (subclasses may override).
   */
  protected abstract fetchPlaywright(input: SearchInput): Promise<string | null>;

  /**
   * Extract structured data from HTML using AI price extractor + match evaluator.
   * Default implementation works for any vendor whose HTML can be parsed by the
   * generic LLM extractor. Subclasses can override for vendor-specific quirks.
   */
  protected async extractFromHtml(
    html: string,
    input: SearchInput
  ): Promise<VendorSearchResult | null> {
    const products = await extractPricesFromHtml(
      html,
      input.searchQuery,
      this.config.slug,
      this.config.extractionHints
    );

    if (products.length === 0) return null;

    const evaluation = await evaluateMatch(
      input.rfqDescription,
      input.normalizedName,
      products,
      this.config.category,
      input.impaCode,
      this.config.slug
    );

    if (evaluation.bestMatchIndex < 0 || evaluation.confidence < 0.2) {
      logger.info(
        {
          vendor: this.config.slug,
          searchQuery: input.searchQuery,
          rfqDescription: input.rfqDescription,
          confidence: evaluation.confidence,
          reasoning: evaluation.reasoning,
          warnings: evaluation.warnings,
          rejectedCandidates: products.map((p) => ({
            name: p.productName,
            price: p.price,
          })),
        },
        "No acceptable match found"
      );
      return null;
    }

    const best = products[evaluation.bestMatchIndex];

    return {
      vendorSlug: this.config.slug,
      productName: best.productName,
      productId: best.productId,
      productUrl: best.productUrl,
      price: best.price,
      currency: best.currency,
      pricePerUnit: best.pricePerUnit,
      inStock: best.inStock,
      deliveryEstimate: best.deliveryEstimate,
      imageUrl: best.imageUrl,
    };
  }

  /**
   * Rate limiter — ensures minimum delay between requests.
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.config.rateLimitMs) {
      await new Promise((r) => setTimeout(r, this.config.rateLimitMs - elapsed));
    }
    this.lastRequestTime = Date.now();
  }
}
