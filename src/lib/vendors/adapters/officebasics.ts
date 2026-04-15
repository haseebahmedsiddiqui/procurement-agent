import { BaseVendorAdapter, type SearchInput } from "../base-adapter";
import { browserPool } from "@/lib/auth/browser-pool";
import { loadSession } from "@/lib/auth/session-store";
import { logger } from "@/lib/logger";

/**
 * OfficeBasics adapter — stationery category, B2B login-gated.
 *
 * Strategy:
 *   Layer 2 (HTTP): SKIPPED — prices and product visibility require an
 *                   authenticated session that the HTTP layer cannot maintain.
 *   Layer 3 (Playwright): primary path. Uses saved session cookies.
 *
 * OfficeBasics notes:
 *   - Sessions are short-lived (~48 hours) — auth-manager should refresh
 *   - Wholesale/bulk pricing only visible after login
 *   - Smaller catalog than Staples — broader queries help
 */
export class OfficeBasicsAdapter extends BaseVendorAdapter {
  protected async fetchHttp(): Promise<string | null> {
    // Login-gated: skip HTTP entirely. The base-adapter strategy will fall
    // through to the Playwright layer because we return null here.
    logger.info(
      { vendor: this.config.slug },
      "OfficeBasics is login-gated, skipping HTTP layer"
    );
    return null;
  }

  protected async fetchPlaywright(input: SearchInput): Promise<string | null> {
    const url = this.buildSearchUrl(input.searchQuery);
    logger.info(
      { vendor: this.config.slug, url },
      "OfficeBasics Playwright fetch"
    );

    const session = await loadSession(this.config.slug);
    if (!session) {
      logger.warn(
        { vendor: this.config.slug },
        "OfficeBasics has no saved session — login required"
      );
      return null;
    }

    try {
      const page = await browserPool.getPage(this.config.slug, session.cookies);

      await page.waitForTimeout(500 + Math.random() * 800);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(1500 + Math.random() * 1500);

      // Detect a logout / session-expired redirect
      const currentUrl = page.url();
      if (currentUrl.includes("/login") || currentUrl.includes("/signin")) {
        logger.warn(
          { vendor: this.config.slug, redirectedTo: currentUrl },
          "OfficeBasics session expired during search"
        );
        await page.close();
        await browserPool.closeContext(this.config.slug);
        return null;
      }

      // Trigger lazy-loaded price tiles
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(600);

      const html = await page.content();

      await page.close();
      await browserPool.closeContext(this.config.slug);

      return html;
    } catch (err) {
      logger.error(
        { vendor: this.config.slug, error: err },
        "OfficeBasics Playwright error"
      );
      await browserPool.closeContext(this.config.slug);
      return null;
    }
  }
}
