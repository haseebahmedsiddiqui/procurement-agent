import { BaseVendorAdapter, type SearchInput } from "../base-adapter";
import { browserPool } from "@/lib/auth/browser-pool";
import { loadSession } from "@/lib/auth/session-store";
import { logger } from "@/lib/logger";

/**
 * Grainger adapter — deck/engine category.
 *
 * Strategy:
 *   Layer 2 (primary): HTTP fetch (list pricing is publicly visible)
 *   Layer 3 (fallback): Playwright with saved session (account pricing)
 *
 * Grainger notes:
 *   - Item-number IDs (e.g., "5JL09")
 *   - Public list price visible without login
 *   - Account pricing differs — needs login session
 *   - Minimum order quantities common
 */
export class GraingerAdapter extends BaseVendorAdapter {
  protected async fetchHttp(input: SearchInput): Promise<string | null> {
    const url = this.buildSearchUrl(input.searchQuery);
    logger.info({ vendor: this.config.slug, url }, "Grainger HTTP fetch");

    const session = await loadSession(this.config.slug);
    const cookieHeader = session?.cookies
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        redirect: "follow",
      });

      if (!response.ok) {
        logger.warn(
          { vendor: this.config.slug, status: response.status },
          "Grainger HTTP non-OK response"
        );
        if (response.status === 403 || response.status === 429) {
          this.lastErrorType = "blocked";
          this.lastErrorMessage = `Grainger returned ${response.status}`;
        }
        return null;
      }

      const html = await response.text();

      if (this.isBlocked(html)) {
        logger.warn({ vendor: this.config.slug }, "Grainger block page");
        this.lastErrorType = "blocked";
        this.lastErrorMessage = "Grainger block page";
        return null;
      }

      return html;
    } catch (err) {
      logger.error(
        { vendor: this.config.slug, error: err },
        "Grainger HTTP fetch error"
      );
      return null;
    }
  }

  protected async fetchPlaywright(input: SearchInput): Promise<string | null> {
    const url = this.buildSearchUrl(input.searchQuery);
    logger.info(
      { vendor: this.config.slug, url },
      "Grainger Playwright fetch"
    );

    try {
      const session = await loadSession(this.config.slug);
      const page = await browserPool.getPage(this.config.slug, session?.cookies);

      await page.waitForTimeout(500 + Math.random() * 800);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(1200 + Math.random() * 1500);

      await page.evaluate(() => window.scrollBy(0, 700));
      await page.waitForTimeout(500);

      const html = await page.content();

      await page.close();
      await browserPool.closeContext(this.config.slug);

      if (this.isBlocked(html)) {
        logger.warn(
          { vendor: this.config.slug },
          "Grainger block page in Playwright"
        );
        this.lastErrorType = "blocked";
        return null;
      }

      return html;
    } catch (err) {
      logger.error(
        { vendor: this.config.slug, error: err },
        "Grainger Playwright error"
      );
      await browserPool.closeContext(this.config.slug);
      return null;
    }
  }

  private isBlocked(html: string): boolean {
    const signals = [
      "access denied",
      "request blocked",
      "pardon our interruption",
      "are you a human",
      "captcha",
    ];
    const lower = html.toLowerCase();
    return signals.some((s) => lower.includes(s));
  }
}
