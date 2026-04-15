import { BaseVendorAdapter, type SearchInput } from "../base-adapter";
import { browserPool } from "@/lib/auth/browser-pool";
import { loadSession } from "@/lib/auth/session-store";
import { logger } from "@/lib/logger";

/**
 * McMaster-Carr adapter — deck/engine category. The HARDEST vendor.
 *
 * Strategy:
 *   Layer 2 (HTTP): SKIPPED — McMaster aggressively blocks non-browser clients
 *                   and serves a JS shell with no inline product data.
 *   Layer 3 (Playwright): primary path. Heavy stealth + human-like behavior.
 *
 * McMaster notes:
 *   - Uses part numbers, not product names. Search query gen should use
 *     technical terms (handled at the LLM normalizer layer via vendor.searchQueryTemplate).
 *   - CAPTCHA / Distil / PerimeterX challenges appear under load.
 *   - Sessions are short-lived (~48h) and login is account-required for
 *     visible pricing on most catalog pages.
 *   - Search URL pattern is `/<query>` not `?q=` — already configured in seed data.
 */
export class McMasterAdapter extends BaseVendorAdapter {
  protected async fetchHttp(): Promise<string | null> {
    // McMaster blocks non-browser fetches outright. Skip to Playwright.
    logger.info(
      { vendor: this.config.slug },
      "McMaster bypasses HTTP layer (anti-bot)"
    );
    return null;
  }

  protected async fetchPlaywright(input: SearchInput): Promise<string | null> {
    const url = this.buildSearchUrl(input.searchQuery);
    logger.info({ vendor: this.config.slug, url }, "McMaster Playwright fetch");

    const session = await loadSession(this.config.slug);
    if (!session) {
      logger.warn(
        { vendor: this.config.slug },
        "McMaster has no saved session — login required for pricing"
      );
      this.lastErrorType = "auth_expired";
      this.lastErrorMessage =
        "McMaster session not found — please log in via Settings";
      return null;
    }

    let page;
    try {
      page = await browserPool.getPage(this.config.slug, session.cookies);

      // Extra stealth init: hide common automation tells beyond webdriver flag
      await page.addInitScript(() => {
        // languages
        Object.defineProperty(navigator, "languages", {
          get: () => ["en-US", "en"],
        });
        // plugins length
        Object.defineProperty(navigator, "plugins", {
          get: () => [1, 2, 3, 4, 5],
        });
        // chrome runtime stub
        // @ts-expect-error - injecting chrome stub for stealth
        window.chrome = { runtime: {} };
      });

      // Slow human-like warm-up before navigation
      await page.waitForTimeout(800 + Math.random() * 1200);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1500 + Math.random() * 2000);

      // Detect CAPTCHA / interstitial BEFORE doing anything else
      const earlyHtml = await page.content();
      if (this.isCaptcha(earlyHtml, page.url())) {
        logger.warn(
          { vendor: this.config.slug, url: page.url() },
          "McMaster CAPTCHA / challenge detected"
        );
        this.lastErrorType = "captcha";
        this.lastErrorMessage =
          "McMaster CAPTCHA detected — please open the visible browser and solve it, then retry.";
        await page.close();
        await browserPool.closeContext(this.config.slug);
        return null;
      }

      // Detect session-expired redirect to login
      if (
        page.url().includes("/login") ||
        page.url().includes("/Login") ||
        page.url().includes("/signin")
      ) {
        logger.warn(
          { vendor: this.config.slug, redirectedTo: page.url() },
          "McMaster session expired"
        );
        this.lastErrorType = "auth_expired";
        this.lastErrorMessage =
          "McMaster session expired — please log in via Settings";
        await page.close();
        await browserPool.closeContext(this.config.slug);
        return null;
      }

      // Human-like scrolling to trigger lazy product tiles
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollBy(0, 400));
        await page.waitForTimeout(300 + Math.random() * 400);
      }

      const html = await page.content();

      await page.close();
      await browserPool.closeContext(this.config.slug);

      // Re-check CAPTCHA — sometimes triggered after scroll
      if (this.isCaptcha(html, url)) {
        logger.warn(
          { vendor: this.config.slug },
          "McMaster CAPTCHA appeared after interaction"
        );
        this.lastErrorType = "captcha";
        this.lastErrorMessage = "McMaster CAPTCHA detected mid-search";
        return null;
      }

      return html;
    } catch (err) {
      logger.error(
        { vendor: this.config.slug, error: err },
        "McMaster Playwright error"
      );
      try {
        if (page) await page.close();
      } catch {
        // ignore
      }
      await browserPool.closeContext(this.config.slug);
      this.lastErrorType = "error";
      this.lastErrorMessage =
        err instanceof Error ? err.message : "McMaster fetch error";
      return null;
    }
  }

  private isCaptcha(html: string, currentUrl: string): boolean {
    const lower = html.toLowerCase();
    const urlLower = currentUrl.toLowerCase();

    const urlSignals = [
      "captcha",
      "challenge",
      "px-captcha",
      "perimeterx",
      "distil",
    ];
    if (urlSignals.some((s) => urlLower.includes(s))) return true;

    const htmlSignals = [
      "px-captcha",
      "perimeterx",
      "distil_r_captcha",
      "please verify you are a human",
      "are you a robot",
      "complete the security check",
      "unusual traffic from your network",
    ];
    return htmlSignals.some((s) => lower.includes(s));
  }
}
