import { type Page } from "playwright";
import { browserPool } from "./browser-pool";
import {
  saveSession,
  validateSession,
  deleteSession,
  getAllSessionStatuses,
} from "./session-store";
import { getLoginDetector } from "./login-detectors";
import { connectDB } from "@/lib/db/connection";
import { Vendor } from "@/lib/db/models/Vendor";
import { logger } from "@/lib/logger";

export type AuthStatus =
  | "connected"      // Valid session exists
  | "expired"        // Session exists but expired
  | "not_configured" // No session, auth required
  | "not_required";  // Vendor doesn't need auth

export interface VendorAuthInfo {
  vendorSlug: string;
  status: AuthStatus;
  savedAt?: string;
  expiresAt?: string;
}

/**
 * Check auth status for a single vendor.
 */
export async function getAuthStatus(vendorSlug: string): Promise<VendorAuthInfo> {
  await connectDB();
  const vendor = await Vendor.findOne({ slug: vendorSlug }).lean();

  if (!vendor) {
    return { vendorSlug, status: "not_configured" };
  }

  if (!vendor.authRequired) {
    return { vendorSlug, status: "not_required" };
  }

  const result = await validateSession(vendorSlug);

  if (result.valid && result.session) {
    return {
      vendorSlug,
      status: "connected",
      savedAt: result.session.savedAt,
      expiresAt: result.session.expiresAt,
    };
  }

  if (result.session && result.reason === "expired") {
    return {
      vendorSlug,
      status: "expired",
      savedAt: result.session.savedAt,
      expiresAt: result.session.expiresAt,
    };
  }

  return { vendorSlug, status: "not_configured" };
}

/**
 * Get auth status for all vendors.
 */
export async function getAllAuthStatuses(): Promise<VendorAuthInfo[]> {
  await connectDB();
  const vendors = await Vendor.find({ enabled: true }).lean();
  const sessionStatuses = await getAllSessionStatuses();

  return vendors.map((vendor) => {
    if (!vendor.authRequired) {
      return { vendorSlug: vendor.slug, status: "not_required" as AuthStatus };
    }

    const session = sessionStatuses[vendor.slug];
    if (!session) {
      return { vendorSlug: vendor.slug, status: "not_configured" as AuthStatus };
    }

    if (session.valid) {
      return {
        vendorSlug: vendor.slug,
        status: "connected" as AuthStatus,
        savedAt: session.savedAt,
        expiresAt: session.expiresAt,
      };
    }

    if (session.reason === "expired") {
      return {
        vendorSlug: vendor.slug,
        status: "expired" as AuthStatus,
        savedAt: session.savedAt,
        expiresAt: session.expiresAt,
      };
    }

    return { vendorSlug: vendor.slug, status: "not_configured" as AuthStatus };
  });
}

/**
 * Ensure a vendor is logged in. Returns a Page with valid session.
 *
 * Uses vendor-specific login detectors for Amazon, Staples, OfficeBasics, McMaster.
 */
export async function ensureLoggedIn(vendorSlug: string): Promise<Page> {
  await connectDB();
  const vendor = await Vendor.findOne({ slug: vendorSlug }).lean();

  if (!vendor) {
    throw new Error(`Vendor not found: ${vendorSlug}`);
  }

  if (!vendor.authRequired) {
    logger.info({ vendor: vendorSlug }, "No auth required, returning fresh page");
    return browserPool.getPage(vendorSlug);
  }

  const detector = getLoginDetector(vendorSlug);

  // Try existing session
  const sessionResult = await validateSession(vendorSlug);

  if (sessionResult.valid && sessionResult.session) {
    logger.info({ vendor: vendorSlug }, "Valid session found, verifying...");

    const page = await browserPool.getPage(
      vendorSlug,
      sessionResult.session.cookies
    );

    // Verify using vendor-specific detector
    if (vendor.dashboardUrl) {
      try {
        await page.goto(vendor.dashboardUrl, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });

        const loggedIn = await detector.isLoggedIn(page);

        if (loggedIn) {
          logger.info({ vendor: vendorSlug }, "Session verified via detector");
          return page;
        }
      } catch (err) {
        logger.warn(
          { vendor: vendorSlug, error: err },
          "Session verification failed"
        );
      }
    }

    // Session didn't verify, close and fall through to login
    await browserPool.closeContext(vendorSlug);
    logger.info({ vendor: vendorSlug }, "Session invalid, need fresh login");
  }

  // Need manual login — use vendor-specific detector
  return startLoginFlow(vendor, detector);
}

/**
 * Open vendor login page for manual login using vendor-specific detection.
 */
async function startLoginFlow(
  vendor: {
    slug: string;
    loginUrl?: string | null;
    dashboardUrl?: string | null;
    baseUrl: string;
    sessionMaxAgeHours: number;
  },
  detector: ReturnType<typeof getLoginDetector>
): Promise<Page> {
  const loginUrl = vendor.loginUrl || vendor.baseUrl;

  logger.info(
    { vendor: vendor.slug, loginUrl },
    "Starting manual login flow — browser will open"
  );

  const page = await browserPool.getPage(vendor.slug);

  // Use vendor-specific login detection
  await detector.waitForLogin(
    page,
    loginUrl,
    vendor.dashboardUrl ?? undefined
  );

  logger.info({ vendor: vendor.slug }, "Login completed, saving session");

  // Capture and save cookies
  const context = page.context();
  const cookies = await context.cookies();

  await saveSession(vendor.slug, cookies, vendor.sessionMaxAgeHours);

  return page;
}

/**
 * Force a fresh login for a vendor (e.g., when session is expired).
 */
export async function forceLogin(vendorSlug: string): Promise<Page> {
  await connectDB();
  const vendor = await Vendor.findOne({ slug: vendorSlug }).lean();

  if (!vendor) {
    throw new Error(`Vendor not found: ${vendorSlug}`);
  }

  await deleteSession(vendorSlug);
  await browserPool.closeContext(vendorSlug);

  const detector = getLoginDetector(vendorSlug);
  return startLoginFlow(vendor, detector);
}

/**
 * Health check: verify a vendor's session is still valid
 * by navigating to their dashboard with saved cookies.
 * Does not open a visible browser if session is dead — just reports status.
 */
export async function checkSessionHealth(
  vendorSlug: string
): Promise<{ healthy: boolean; reason: string }> {
  await connectDB();
  const vendor = await Vendor.findOne({ slug: vendorSlug }).lean();

  if (!vendor) {
    return { healthy: false, reason: "vendor_not_found" };
  }

  if (!vendor.authRequired) {
    return { healthy: true, reason: "no_auth_required" };
  }

  const sessionResult = await validateSession(vendorSlug);
  if (!sessionResult.valid) {
    return { healthy: false, reason: sessionResult.reason || "invalid_session" };
  }

  // Session file exists and hasn't expired — optionally do a live check
  if (!vendor.dashboardUrl) {
    return { healthy: true, reason: "session_file_valid" };
  }

  try {
    const page = await browserPool.getPage(
      vendorSlug,
      sessionResult.session!.cookies
    );

    await page.goto(vendor.dashboardUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    const detector = getLoginDetector(vendorSlug);
    const loggedIn = await detector.isLoggedIn(page);

    await page.close();
    await browserPool.closeContext(vendorSlug);

    if (loggedIn) {
      // Update vendor health status in DB
      await Vendor.updateOne(
        { slug: vendorSlug },
        { lastHealthCheck: new Date(), healthStatus: "healthy" }
      );
      return { healthy: true, reason: "session_verified" };
    } else {
      await Vendor.updateOne(
        { slug: vendorSlug },
        { lastHealthCheck: new Date(), healthStatus: "degraded" }
      );
      return { healthy: false, reason: "session_rejected_by_vendor" };
    }
  } catch (err) {
    await browserPool.closeContext(vendorSlug);
    logger.warn({ vendor: vendorSlug, error: err }, "Health check failed");
    return { healthy: false, reason: "health_check_error" };
  }
}

/**
 * Disconnect a vendor (delete session, close context).
 */
export async function disconnect(vendorSlug: string): Promise<void> {
  await deleteSession(vendorSlug);
  await browserPool.closeContext(vendorSlug);
  logger.info({ vendor: vendorSlug }, "Vendor disconnected");
}
