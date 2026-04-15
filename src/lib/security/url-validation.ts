/**
 * URL safety helpers for user-supplied vendor URLs.
 *
 * Block private/loopback/link-local hosts so a custom store URL can't be
 * used to SSRF the deployment's internal network.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || h === "[::1]") return true;

  // Block IPv6-mapped IPv4 (e.g. ::ffff:127.0.0.1, [::ffff:10.0.0.1])
  const mapped = h.match(/^(?:\[)?::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?:])?$/i);
  if (mapped) return isPrivateHost(mapped[1]);

  // IPv4 ranges
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }

  // .internal / .local mDNS
  if (h.endsWith(".internal") || h.endsWith(".local")) return true;
  return false;
}

export type UrlValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateUrl(url: string): UrlValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "URL must use http or https" };
  }
  if (isPrivateHost(parsed.hostname)) {
    return { ok: false, reason: "URL points to a private/internal host" };
  }
  return { ok: true };
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
