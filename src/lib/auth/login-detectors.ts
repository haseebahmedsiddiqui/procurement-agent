import type { Page } from "playwright";
import { logger } from "@/lib/logger";

/**
 * Vendor-specific login detection strategies.
 *
 * Each detector knows how to:
 * 1. Detect when a user has successfully logged in
 * 2. Verify that an existing session is still valid
 *
 * The generic detector works for most vendors, but some need
 * special handling (e.g., Amazon's multi-step login, McMaster's anti-bot).
 */

export interface LoginDetector {
  /** Wait for user to complete login. Resolves when logged in. */
  waitForLogin(page: Page, loginUrl: string, dashboardUrl?: string): Promise<void>;
  /** Check if page shows a logged-in state (after navigating to dashboard). */
  isLoggedIn(page: Page): Promise<boolean>;
}

// ======================== AMAZON ========================
// Amazon has multi-step login (email → password → optional OTP)
// After login, redirects to homepage or last-visited page.
// Key indicators: "nav-link-accountList" shows account name, not "Sign in"
const amazonDetector: LoginDetector = {
  async waitForLogin(page, loginUrl) {
    logger.info("Amazon: waiting for login completion...");

    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Wait for any of these post-login signals
    await Promise.race([
      // User lands on a non-login Amazon page with the account nav present
      page.waitForFunction(
        () => {
          const accountEl = document.querySelector("#nav-link-accountList");
          if (!accountEl) return false;
          const text = accountEl.textContent || "";
          // "Hello, Sign in" = not logged in; "Hello, Name" = logged in
          return !text.includes("Sign in");
        },
        { timeout: 300000 }
      ),
      // Or user navigates away from signin pages entirely
      page.waitForURL(
        (url) =>
          !url.pathname.includes("/ap/signin") &&
          !url.pathname.includes("/ap/mfa") &&
          !url.pathname.includes("/ap/cvf") &&
          url.hostname.includes("amazon.com"),
        { timeout: 300000 }
      ),
    ]);

    // Wait an extra second for cookies to settle
    await page.waitForTimeout(1500);
    logger.info("Amazon: login detected");
  },

  async isLoggedIn(page) {
    try {
      const accountText = await page.textContent("#nav-link-accountList", {
        timeout: 5000,
      });
      return !!accountText && !accountText.includes("Sign in");
    } catch {
      return false;
    }
  },
};

// ======================== STAPLES ========================
// Staples uses standard form login. After login, redirects to account or homepage.
// Key indicator: presence of account menu / "My Account" link
const staplesDetector: LoginDetector = {
  async waitForLogin(page, loginUrl) {
    logger.info("Staples: waiting for login completion...");

    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    await page.waitForURL(
      (url) =>
        !url.pathname.includes("/account/login") &&
        !url.pathname.includes("/signin") &&
        url.hostname.includes("staples.com"),
      { timeout: 300000 }
    );

    await page.waitForTimeout(1000);
    logger.info("Staples: login detected");
  },

  async isLoggedIn(page) {
    try {
      // Check if the page has an account/sign-out indicator
      const signOutLink = await page.$('a[href*="logout"], a[href*="signout"]');
      if (signOutLink) return true;

      // Check if we're NOT on a login page
      const url = page.url();
      return !url.includes("login") && !url.includes("signin");
    } catch {
      return false;
    }
  },
};

// ======================== OFFICEBASICS ========================
// OfficeBasics is a B2B portal — login-gated with short-lived sessions.
// After login, typically redirects to main catalog or account dashboard.
const officebasicsDetector: LoginDetector = {
  async waitForLogin(page, loginUrl) {
    logger.info("OfficeBasics: waiting for login completion...");

    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    await page.waitForURL(
      (url) =>
        !url.pathname.includes("/login") &&
        !url.pathname.includes("/signin") &&
        url.hostname.includes("officebasics.com"),
      { timeout: 300000 }
    );

    await page.waitForTimeout(1000);
    logger.info("OfficeBasics: login detected");
  },

  async isLoggedIn(page) {
    try {
      const url = page.url();
      return !url.includes("login") && !url.includes("signin");
    } catch {
      return false;
    }
  },
};

// ======================== MCMASTER-CARR ========================
// McMaster has aggressive anti-bot. Login goes through their standard form.
// After login, redirects to homepage or order history.
// Extra stealth: add random delays before interacting.
const mcmasterDetector: LoginDetector = {
  async waitForLogin(page, loginUrl) {
    logger.info("McMaster-Carr: waiting for login completion (use stealth!)...");

    // Add human-like delay before navigating
    await page.waitForTimeout(500 + Math.random() * 1000);
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    await page.waitForURL(
      (url) =>
        !url.pathname.includes("/login") &&
        url.hostname.includes("mcmaster.com"),
      { timeout: 300000 }
    );

    // McMaster needs extra time for session to fully initialize
    await page.waitForTimeout(2000);
    logger.info("McMaster-Carr: login detected");
  },

  async isLoggedIn(page) {
    try {
      const url = page.url();
      if (url.includes("/login")) return false;

      // Check for order history or logged-in nav elements
      const loggedInIndicator = await page.$(
        '[data-testid="log-out-link"], a[href*="logout"], a[href*="log-out"]'
      );
      return !!loggedInIndicator || !url.includes("login");
    } catch {
      return false;
    }
  },
};

// ======================== GENERIC ========================
// Fallback for any vendor without a specific detector.
const genericDetector: LoginDetector = {
  async waitForLogin(page, loginUrl, dashboardUrl) {
    logger.info("Generic: waiting for login completion...");

    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    const dashboardPath = dashboardUrl ? new URL(dashboardUrl).pathname : null;

    await page.waitForURL(
      (url) => {
        if (!url.href.includes("login") && !url.href.includes("signin")) return true;
        if (dashboardPath && url.pathname.includes(dashboardPath)) return true;
        return false;
      },
      { timeout: 300000 }
    );

    await page.waitForTimeout(1000);
    logger.info("Generic: login detected");
  },

  async isLoggedIn(page) {
    const url = page.url();
    return !url.includes("login") && !url.includes("signin");
  },
};

// ======================== REGISTRY ========================
const detectorRegistry: Record<string, LoginDetector> = {
  amazon: amazonDetector,
  "amazon-deck": amazonDetector,
  "amazon-galley": amazonDetector,
  staples: staplesDetector,
  officebasics: officebasicsDetector,
  mcmaster: mcmasterDetector,
};

export function getLoginDetector(vendorSlug: string): LoginDetector {
  return detectorRegistry[vendorSlug] ?? genericDetector;
}
