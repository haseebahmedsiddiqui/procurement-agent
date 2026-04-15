import { describe, it, expect, beforeEach } from "vitest";
import {
  getBreaker,
  getAllBreakerStatuses,
  resetBreaker,
} from "@/lib/vendors/circuit-breaker";

describe("CircuitBreaker", () => {
  beforeEach(() => {
    // Reset all breakers between tests
    resetBreaker("test-vendor");
    resetBreaker("vendor-a");
    resetBreaker("vendor-b");
  });

  it("starts in closed state", () => {
    const b = getBreaker("test-vendor");
    const s = b.getStatus();
    expect(s.state).toBe("closed");
    expect(s.failures).toBe(0);
    expect(b.canRequest()).toBe(true);
  });

  it("stays closed under threshold", () => {
    const b = getBreaker("test-vendor");
    b.recordFailure();
    b.recordFailure();
    expect(b.getStatus().state).toBe("closed");
    expect(b.canRequest()).toBe(true);
  });

  it("opens after 3 consecutive failures", () => {
    const b = getBreaker("test-vendor");
    b.recordFailure();
    b.recordFailure();
    b.recordFailure();
    expect(b.getStatus().state).toBe("open");
    expect(b.canRequest()).toBe(false);
  });

  it("resets failure count on success", () => {
    const b = getBreaker("test-vendor");
    b.recordFailure();
    b.recordFailure();
    b.recordSuccess();
    expect(b.getStatus().failures).toBe(0);
    expect(b.getStatus().state).toBe("closed");
    // Two more failures still shouldn't open it
    b.recordFailure();
    b.recordFailure();
    expect(b.getStatus().state).toBe("closed");
  });

  it("manual reset brings it back to closed", () => {
    const b = getBreaker("test-vendor");
    b.recordFailure();
    b.recordFailure();
    b.recordFailure();
    expect(b.getStatus().state).toBe("open");
    b.reset();
    expect(b.getStatus().state).toBe("closed");
    expect(b.canRequest()).toBe(true);
  });

  it("tracks separate breakers per vendor", () => {
    const a = getBreaker("vendor-a");
    const b = getBreaker("vendor-b");
    a.recordFailure();
    a.recordFailure();
    a.recordFailure();
    expect(a.getStatus().state).toBe("open");
    expect(b.getStatus().state).toBe("closed");
  });

  it("records lastSuccess and lastFailure timestamps", () => {
    const b = getBreaker("test-vendor");
    b.recordFailure();
    expect(b.getStatus().lastFailure).toBeTypeOf("number");
    b.recordSuccess();
    expect(b.getStatus().lastSuccess).toBeTypeOf("number");
  });

  it("getAllBreakerStatuses returns all registered breakers", () => {
    getBreaker("vendor-a").recordSuccess();
    getBreaker("vendor-b").recordFailure();
    const all = getAllBreakerStatuses();
    expect(all["vendor-a"]).toBeDefined();
    expect(all["vendor-b"]).toBeDefined();
    expect(all["vendor-a"].state).toBe("closed");
  });
});
