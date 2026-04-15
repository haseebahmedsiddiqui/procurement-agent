import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { logger } from "@/lib/logger";

/** Max concurrent Playwright browser contexts (configurable via env). */
const MAX_CONTEXTS = Math.max(
  1,
  parseInt(process.env.BROWSER_MAX_CONTEXTS ?? "3", 10) || 3
);

interface ContextEntry {
  context: BrowserContext;
  vendorSlug: string;
  createdAt: Date;
}

class BrowserPool {
  private browser: Browser | null = null;
  private contexts: Map<string, ContextEntry> = new Map();
  private launching: Promise<Browser> | null = null;

  async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) {
      return this.browser;
    }

    // Prevent multiple simultaneous launches
    if (this.launching) {
      return this.launching;
    }

    this.launching = chromium.launch({
      headless: false, // Visible for manual login flows
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
      ],
    });

    try {
      this.browser = await this.launching;
      logger.info("Browser launched");

      this.browser.on("disconnected", () => {
        logger.info("Browser disconnected");
        this.browser = null;
        this.contexts.clear();
      });

      return this.browser;
    } finally {
      this.launching = null;
    }
  }

  async createContext(
    vendorSlug: string,
    cookies?: Parameters<BrowserContext["addCookies"]>[0]
  ): Promise<BrowserContext> {
    // Evict oldest context if at capacity
    if (this.contexts.size >= MAX_CONTEXTS) {
      const oldest = [...this.contexts.entries()].sort(
        (a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime()
      )[0];
      if (oldest) {
        logger.info({ vendor: oldest[0] }, "Evicting oldest browser context");
        await oldest[1].context.close();
        this.contexts.delete(oldest[0]);
      }
    }

    // Close existing context for this vendor if any
    const existing = this.contexts.get(vendorSlug);
    if (existing) {
      await existing.context.close();
      this.contexts.delete(vendorSlug);
    }

    const browser = await this.getBrowser();
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      viewport: {
        width: 1280 + Math.floor(Math.random() * 100),
        height: 800 + Math.floor(Math.random() * 100),
      },
      locale: "en-US",
      timezoneId: "America/New_York",
    });

    if (cookies?.length) {
      await context.addCookies(cookies);
    }

    this.contexts.set(vendorSlug, {
      context,
      vendorSlug,
      createdAt: new Date(),
    });

    logger.info({ vendor: vendorSlug }, "Browser context created");
    return context;
  }

  async getPage(
    vendorSlug: string,
    cookies?: Parameters<BrowserContext["addCookies"]>[0]
  ): Promise<Page> {
    const context = await this.createContext(vendorSlug, cookies);
    const page = await context.newPage();

    // Stealth: remove webdriver flag
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => false,
      });
    });

    return page;
  }

  async closeContext(vendorSlug: string): Promise<void> {
    const entry = this.contexts.get(vendorSlug);
    if (entry) {
      await entry.context.close();
      this.contexts.delete(vendorSlug);
      logger.info({ vendor: vendorSlug }, "Browser context closed");
    }
  }

  async closeAll(): Promise<void> {
    for (const [slug, entry] of this.contexts) {
      await entry.context.close();
      this.contexts.delete(slug);
    }
    if (this.browser?.isConnected()) {
      await this.browser.close();
      this.browser = null;
    }
    logger.info("All browser contexts and browser closed");
  }

  getActiveContextCount(): number {
    return this.contexts.size;
  }

  getActiveVendors(): string[] {
    return [...this.contexts.keys()];
  }
}

// Singleton
export const browserPool = new BrowserPool();
