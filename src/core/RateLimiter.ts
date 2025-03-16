import Bottleneck from "bottleneck";

export class RateLimiter {
  private limiter: Bottleneck;

  constructor(maxRequests: number, perMilliseconds: number) {
    this.limiter = new Bottleneck({
      maxConcurrent: maxRequests,
      minTime: perMilliseconds / maxRequests,
    });
  }

  schedule<T>(fn: (...args: any[]) => Promise<T>, ...args: any[]): Promise<T> {
    return this.limiter.schedule(() => fn(...args));
  }
}

export class TokenBucketRateLimiter {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillRate: number;
  private lastRefillTimestamp: number;

  constructor(maxQueriesPerSecond: number) {
    this.capacity = maxQueriesPerSecond;
    this.tokens = maxQueriesPerSecond;
    this.refillRate = maxQueriesPerSecond / 1000; // Rate per millisecond
    this.lastRefillTimestamp = Date.now();
  }

  private refillTokens() {
    const now = Date.now();
    const elapsedTime = now - this.lastRefillTimestamp;
    const newTokens = elapsedTime * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + newTokens);
    this.lastRefillTimestamp = now;
  }

  async acquire(): Promise<void> {
    this.refillTokens();

    while (this.tokens < 1) {
      await new Promise((resolve) => setTimeout(resolve, 10)); // Small wait time
      this.refillTokens();
    }

    this.tokens -= 1; // Consume one token
  }
}
