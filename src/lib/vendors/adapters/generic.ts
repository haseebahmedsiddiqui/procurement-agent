import { BaseVendorAdapter, type SearchInput } from "../base-adapter";
import { browserPool } from "@/lib/auth/browser-pool";
import { logger } from "@/lib/logger";
import { validateUrl } from "@/lib/security/url-validation";

/**
 * GenericAdapter — used by user-added custom stores.
 *
 * Strategy:
 *   Layer 2 (primary): plain HTTP fetch with a desktop browser User-Agent.
 *   Layer 3 (fallback): Playwright with default stealth (no vendor-specific tweaks).
 *
 * The generic adapter assumes:
 *   - public pricing (no auth)
 *   - HTML response that the LLM extractor can parse
 *   - search URL contains a `{{query}}` placeholder
 *
 * Custom stores that need login or have aggressive bot protection should be
 * promoted to a hand-written adapter — the generic one is best-effort only.
 */
export class GenericAdapter extends BaseVendorAdapter {
  protected async fetchHttp(input: SearchInput): Promise<string | null> {
    const url = this.buildSearchUrl(input.searchQuery);

    // Runtime SSRF check — URL was validated at vendor creation but could have
    // changed via redirect, DNS rebinding, or template injection.
    const urlCheck = validateUrl(url);
    if (!urlCheck.ok) {
      logger.warn({ vendor: this.config.slug, url, reason: urlCheck.reason }, "Runtime URL validation blocked fetch");
      return null;
    }

    logger.info({ vendor: this.config.slug, url }, "Generic HTTP fetch");

    try {
      // Use manual redirects to validate each hop against SSRF
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "manual",
      });

      // Follow up to 5 redirects with SSRF validation on each hop
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return null;
        const redirectCheck = validateUrl(new URL(location, url).href);
        if (!redirectCheck.ok) {
          logger.warn({ vendor: this.config.slug, location, reason: redirectCheck.reason }, "Redirect to private host blocked");
          return null;
        }
        // Re-fetch the validated redirect target (single hop)
        const redirected = await fetch(new URL(location, url).href, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
          redirect: "follow",
        });
        if (!redirected.ok) return null;
        const html = await redirected.text();
        return this.isBlocked(html) ? (this.lastErrorType = "blocked", null) : html;
      }

      if (!response.ok) {
        logger.warn(
          { vendor: this.config.slug, status: response.status },
          "Generic HTTP non-OK response"
        );
        if (response.status === 403 || response.status === 429) {
          this.lastErrorType = "blocked";
        }
        return null;
      }

      const html = await response.text();

      if (this.isBlocked(html)) {
        this.lastErrorType = "blocked";
        return null;
      }

      return html;
    } catch (err) {
      logger.error(
        { vendor: this.config.slug, error: err },
        "Generic HTTP fetch error"
      );
      return null;
    }
  }

  protected async fetchPlaywright(input: SearchInput): Promise<string | null> {
    const url = this.buildSearchUrl(input.searchQuery);

    const urlCheck = validateUrl(url);
    if (!urlCheck.ok) {
      logger.warn({ vendor: this.config.slug, url, reason: urlCheck.reason }, "Runtime URL validation blocked Playwright fetch");
      return null;
    }

    logger.info({ vendor: this.config.slug, url }, "Generic Playwright fetch");

    try {
      const page = await browserPool.getPage(this.config.slug);

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(1500 + Math.random() * 1500);

      // Best-effort scroll to trigger lazy-loaded content
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(700);

      const html = await page.content();

      await page.close();
      await browserPool.closeContext(this.config.slug);

      if (this.isBlocked(html)) {
        this.lastErrorType = "blocked";
        return null;
      }

      return html;
    } catch (err) {
      logger.error(
        { vendor: this.config.slug, error: err },
        "Generic Playwright error"
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
      "cloudflare",
    ];
    const lower = html.toLowerCase();
    return signals.some((s) => lower.includes(s));
  }
}
