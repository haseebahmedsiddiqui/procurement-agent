import { describe, it, expect } from "vitest";
import { Semaphore } from "@/lib/vendors/concurrency";

describe("Semaphore", () => {
  it("allows up to max concurrent acquisitions", async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    await sem.acquire();
    expect(sem.active).toBe(2);
    expect(sem.waiting).toBe(0);
  });

  it("blocks beyond max until release", async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    let resolved = false;
    const pending = sem.acquire().then(() => {
      resolved = true;
    });

    // Give the microtask queue a tick
    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);
    expect(sem.waiting).toBe(1);

    sem.release();
    await pending;
    expect(resolved).toBe(true);
    expect(sem.active).toBe(1);
  });

  it("processes waiters in FIFO order", async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    const order: number[] = [];
    const p1 = sem.acquire().then(() => order.push(1));
    const p2 = sem.acquire().then(() => order.push(2));

    sem.release();
    await p1;
    sem.release();
    await p2;

    expect(order).toEqual([1, 2]);
  });

  it("tracks active and waiting counts", async () => {
    const sem = new Semaphore(2);
    expect(sem.active).toBe(0);
    expect(sem.waiting).toBe(0);

    await sem.acquire();
    expect(sem.active).toBe(1);

    await sem.acquire();
    expect(sem.active).toBe(2);

    sem.release();
    expect(sem.active).toBe(1);

    sem.release();
    expect(sem.active).toBe(0);
  });
});
