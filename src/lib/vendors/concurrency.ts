/**
 * Simple async semaphore for limiting concurrent operations.
 *
 * Usage:
 *   const sem = new Semaphore(3);
 *   await sem.acquire();
 *   try { ... } finally { sem.release(); }
 */
export class Semaphore {
  private current = 0;
  private queue: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) next();
  }

  get active(): number {
    return this.current;
  }

  get waiting(): number {
    return this.queue.length;
  }
}

/** Max concurrent vendor search runs. Defaults to 4 (enough for typical 3-5 vendor picks). */
const MAX_VENDOR_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.VENDOR_MAX_CONCURRENCY ?? "4", 10) || 4
);

export const vendorSearchSemaphore = new Semaphore(MAX_VENDOR_CONCURRENCY);
