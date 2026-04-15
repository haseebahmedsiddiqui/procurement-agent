import { describe, it, expect } from "vitest";
import {
  isPrivateHost,
  validateUrl,
  slugify,
} from "@/lib/security/url-validation";

describe("isPrivateHost", () => {
  it("blocks localhost and loopback names", () => {
    expect(isPrivateHost("localhost")).toBe(true);
    expect(isPrivateHost("api.localhost")).toBe(true);
    expect(isPrivateHost("LOCALHOST")).toBe(true);
  });

  it("blocks IPv6 loopback", () => {
    expect(isPrivateHost("::1")).toBe(true);
    expect(isPrivateHost("[::1]")).toBe(true);
  });

  it("blocks IPv6-mapped IPv4 private addresses", () => {
    expect(isPrivateHost("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateHost("[::ffff:10.0.0.1]")).toBe(true);
    expect(isPrivateHost("::ffff:192.168.1.1")).toBe(true);
    expect(isPrivateHost("::ffff:169.254.169.254")).toBe(true);
  });

  it("allows IPv6-mapped IPv4 public addresses", () => {
    expect(isPrivateHost("::ffff:8.8.8.8")).toBe(false);
    expect(isPrivateHost("[::ffff:1.1.1.1]")).toBe(false);
  });

  it("blocks RFC1918 IPv4 ranges", () => {
    expect(isPrivateHost("10.0.0.1")).toBe(true);
    expect(isPrivateHost("10.255.255.255")).toBe(true);
    expect(isPrivateHost("172.16.0.1")).toBe(true);
    expect(isPrivateHost("172.31.255.255")).toBe(true);
    expect(isPrivateHost("192.168.1.1")).toBe(true);
  });

  it("does NOT block public IPs adjacent to RFC1918", () => {
    // 172.15.x.x and 172.32.x.x are public
    expect(isPrivateHost("172.15.0.1")).toBe(false);
    expect(isPrivateHost("172.32.0.1")).toBe(false);
    // 11.x.x.x is public
    expect(isPrivateHost("11.0.0.1")).toBe(false);
  });

  it("blocks loopback and 0.0.0.0 ranges", () => {
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("127.255.255.255")).toBe(true);
    expect(isPrivateHost("0.0.0.0")).toBe(true);
  });

  it("blocks link-local 169.254.0.0/16 (AWS metadata service)", () => {
    expect(isPrivateHost("169.254.169.254")).toBe(true);
    expect(isPrivateHost("169.254.0.1")).toBe(true);
  });

  it("blocks .internal and .local mDNS", () => {
    expect(isPrivateHost("api.internal")).toBe(true);
    expect(isPrivateHost("printer.local")).toBe(true);
    expect(isPrivateHost("foo.bar.internal")).toBe(true);
  });

  it("allows public hostnames", () => {
    expect(isPrivateHost("amazon.com")).toBe(false);
    expect(isPrivateHost("www.staples.com")).toBe(false);
    expect(isPrivateHost("8.8.8.8")).toBe(false);
    expect(isPrivateHost("1.1.1.1")).toBe(false);
  });
});

describe("validateUrl", () => {
  it("accepts valid https URLs", () => {
    expect(validateUrl("https://www.amazon.com/dp/B00")).toEqual({ ok: true });
  });

  it("accepts valid http URLs to public hosts", () => {
    expect(validateUrl("http://example.com/search")).toEqual({ ok: true });
  });

  it("rejects file:// URLs", () => {
    const result = validateUrl("file:///etc/passwd");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/http or https/i);
  });

  it("rejects gopher:// URLs", () => {
    const result = validateUrl("gopher://example.com");
    expect(result.ok).toBe(false);
  });

  it("rejects URLs to private IPs", () => {
    const result = validateUrl("https://10.0.0.1/admin");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/private/i);
  });

  it("rejects URLs to AWS metadata service", () => {
    const result = validateUrl("http://169.254.169.254/latest/meta-data/");
    expect(result.ok).toBe(false);
  });

  it("rejects URLs to localhost on any port", () => {
    expect(validateUrl("http://localhost:8080/x").ok).toBe(false);
    expect(validateUrl("http://127.0.0.1:3000/x").ok).toBe(false);
  });

  it("rejects malformed URLs", () => {
    const result = validateUrl("not a url");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/invalid/i);
  });
});

describe("slugify", () => {
  it("lowercases and replaces spaces with dashes", () => {
    expect(slugify("Marine Supply Co")).toBe("marine-supply-co");
  });

  it("strips special characters", () => {
    expect(slugify("Foo & Bar's Co.")).toBe("foo-bar-s-co");
  });

  it("collapses runs of non-alnum into a single dash", () => {
    expect(slugify("a   b!!!c")).toBe("a-b-c");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugify("---hello---")).toBe("hello");
  });

  it("truncates to 40 characters", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBe(40);
  });

  it("returns empty string for input with no alphanumerics", () => {
    expect(slugify("!!!---")).toBe("");
  });
});
