import {
  BaseVendorAdapter,
  type SearchInput,
} from "../base-adapter";
import { browserPool } from "@/lib/auth/browser-pool";
import { loadSession } from "@/lib/auth/session-store";
import { logger } from "@/lib/logger";

/**
 * Amazon adapter — works across all 3 categories (stationery, deck, galley).
 *
 * Strategy:
 *   Layer 2 (HTTP): SKIPPED — Amazon blocks bare fetch() with 503 even with
 *                   browser User-Agent. Without a real session cookie jar
 *                   from a logged-in Playwright run, HTTP is a 100% loss.
 *                   Skipping saves the ~0.5s round-trip per item.
 *   Layer 3 (Playwright): primary path. Waits for product card selector,
 *                          pre-extracts card HTML before returning so the
 *                          downstream LLM extractor sees dense, focused data
 *                          instead of a 500KB Amazon search document.
 *
 * Amazon-specific handling:
 *   - Bot detection (redirects to CAPTCHA / robot-check page)
 *   - ASINs as product IDs
 */
export class AmazonAdapter extends BaseVendorAdapter {
  protected async fetchHttp(): Promise<string | null> {
    logger.info(
      { vendor: this.config.slug },
      "Amazon bypasses HTTP layer (always 503 without browser session)"
    );
    return null;
  }

  protected async fetchPlaywright(input: SearchInput): Promise<string | null> {
    const url = this.buildSearchUrl(input.searchQuery);
    logger.info({ vendor: this.config.slug, url }, "Amazon Playwright fetch");

    let page;
    try {
      const session = await loadSession(this.config.slug);
      page = await browserPool.getPage(this.config.slug, session?.cookies);

      // Human-like warm-up
      await page.waitForTimeout(500 + Math.random() * 800);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });

      // Wait for actual product cards to render — much more reliable than a fixed sleep
      const cardSelector = '[data-component-type="s-search-result"]';
      const cardsAppeared = await page
        .waitForSelector(cardSelector, { timeout: 8000, state: "attached" })
        .then(() => true)
        .catch(() => false);

      if (!cardsAppeared) {
        // Could be CAPTCHA, no-results page, or slow load — capture full HTML
        // and let the bot detector decide
        const fullHtml = await page.content();
        await page.close();
        await browserPool.closeContext(this.config.slug);

        if (this.isBotDetected(fullHtml)) {
          logger.warn(
            { vendor: this.config.slug },
            "Amazon bot detection in Playwright"
          );
          this.lastErrorType = "captcha";
          this.lastErrorMessage = "Amazon CAPTCHA / robot-check detected";
          return null;
        }

        logger.warn(
          { vendor: this.config.slug },
          "No Amazon product cards found on page"
        );
        return null;
      }

      // Scroll to trigger lazy-loaded prices and review counts
      await page.evaluate(() => window.scrollBy(0, 900));
      await page.waitForTimeout(600);
      await page.evaluate(() => window.scrollBy(0, 600));
      await page.waitForTimeout(300);

      // Pre-extract: first 10 cards — wider net since Prime+4★ filter reduces
      // the result set; more cards gives the AI better coverage.
      const cardsHtml = await page.evaluate(() => {
        const cards = document.querySelectorAll(
          '[data-component-type="s-search-result"]'
        );
        return Array.from(cards)
          .slice(0, 10)
          .map((c) => (c as HTMLElement).outerHTML)
          .join("\n\n");
      });

      // Also grab the canonical URL so the extractor can resolve relative links
      const baseHref = await page.evaluate(() => document.baseURI);

      await page.close();
      await browserPool.closeContext(this.config.slug);

      if (!cardsHtml || cardsHtml.length < 200) {
        logger.warn(
          { vendor: this.config.slug, length: cardsHtml.length },
          "Amazon card HTML suspiciously small"
        );
        return null;
      }

      // Wrap with a base tag so any relative URLs in the cards resolve correctly
      return `<base href="${baseHref}">\n${cardsHtml}`;
    } catch (err) {
      logger.error(
        {
          vendor: this.config.slug,
          err,
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        },
        "Amazon Playwright error"
      );
      try {
        if (page) await page.close();
      } catch {
        // ignore
      }
      await browserPool.closeContext(this.config.slug);
      return null;
    }
  }

  private isBotDetected(html: string): boolean {
    const botSignals = [
      "api-services-support@amazon.com",
      "captcha",
      "robot check",
      "automated access",
      "sorry, we just need to make sure",
      "type the characters you see",
    ];
    const lower = html.toLowerCase();
    return botSignals.some((signal) => lower.includes(signal));
  }
}
