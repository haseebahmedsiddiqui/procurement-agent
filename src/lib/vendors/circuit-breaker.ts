/**
 * Per-vendor circuit breaker.
 *
 * States:
 *   CLOSED  — normal operation, requests pass through
 *   OPEN    — vendor has failed ≥ threshold times, requests are short-circuited
 *   HALF_OPEN — cooldown elapsed, one probe request allowed through
 *
 * A success in HALF_OPEN resets to CLOSED. A failure in HALF_OPEN re-opens.
 */

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitStatus {
  state: CircuitState;
  failures: number;
  lastFailure: number | null; // epoch ms
  lastSuccess: number | null;
  openedAt: number | null;
}

interface BreakerConfig {
  /** Number of consecutive failures before opening the circuit. */
  failureThreshold: number;
  /** How long the circuit stays open before transitioning to half_open (ms). */
  cooldownMs: number;
}

const DEFAULT_CONFIG: BreakerConfig = {
  failureThreshold: 3,
  cooldownMs: 60_000, // 1 minute
};

class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private openedAt: number | null = null;
  private config: BreakerConfig;

  constructor(config: Partial<BreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Check if a request should be allowed through. */
  canRequest(): boolean {
    if (this.state === "closed") return true;

    if (this.state === "open") {
      const elapsed = Date.now() - (this.openedAt ?? 0);
      if (elapsed >= this.config.cooldownMs) {
        this.state = "half_open";
        return true; // Allow one probe
      }
      return false;
    }

    // half_open: allow one probe (already transitioned)
    return true;
  }

  /** Record a successful request. */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.lastSuccessTime = Date.now();
    if (this.state === "half_open") {
      this.state = "closed";
      this.openedAt = null;
    }
  }

  /** Record a failed request. */
  recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    if (this.state === "half_open") {
      // Probe failed — re-open
      this.state = "open";
      this.openedAt = Date.now();
      return;
    }

    if (this.consecutiveFailures >= this.config.failureThreshold) {
      this.state = "open";
      this.openedAt = Date.now();
    }
  }

  /** Manual reset (e.g., admin action). */
  reset(): void {
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  getStatus(): CircuitStatus {
    // Refresh state if cooldown has elapsed
    if (this.state === "open") {
      const elapsed = Date.now() - (this.openedAt ?? 0);
      if (elapsed >= this.config.cooldownMs) {
        this.state = "half_open";
      }
    }

    return {
      state: this.state,
      failures: this.consecutiveFailures,
      lastFailure: this.lastFailureTime,
      lastSuccess: this.lastSuccessTime,
      openedAt: this.openedAt,
    };
  }
}

/**
 * Registry of per-vendor circuit breakers.
 * Breakers are created lazily on first access.
 */
const breakers = new Map<string, CircuitBreaker>();

export function getBreaker(vendorSlug: string): CircuitBreaker {
  let breaker = breakers.get(vendorSlug);
  if (!breaker) {
    breaker = new CircuitBreaker();
    breakers.set(vendorSlug, breaker);
  }
  return breaker;
}

export function getAllBreakerStatuses(): Record<string, CircuitStatus> {
  const statuses: Record<string, CircuitStatus> = {};
  for (const [slug, breaker] of breakers) {
    statuses[slug] = breaker.getStatus();
  }
  return statuses;
}

export function resetBreaker(vendorSlug: string): void {
  const breaker = breakers.get(vendorSlug);
  if (breaker) breaker.reset();
}
