import Bottleneck from "bottleneck";
import { Logger as PinoLogger } from "pino";
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

// --- TokenBucketRateLimiter (Custom) ---
export class TokenBucketRateLimiter {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillRate: number; // Rate per millisecond
  private lastRefillTimestamp: number;
  private logger?: PinoLogger;

  constructor(maxRatePerSecond: number, logger?: PinoLogger) {
    if (maxRatePerSecond <= 0) {
      throw new Error(
        "TokenBucketRateLimiter maxRatePerSecond must be positive."
      );
    }
    this.capacity = maxRatePerSecond; // Capacity matches the rate for simplicity here
    this.tokens = this.capacity; // Start full
    this.refillRate = maxRatePerSecond / 1000;
    this.lastRefillTimestamp = Date.now();
    this.logger = logger?.child({ component: "TokenBucketRateLimiter" });

    this.logger?.debug(
      { capacity: this.capacity, refillRate: this.refillRate },
      "Initialized."
    );
  }

  private refillTokens() {
    const now = Date.now();
    const elapsedTime = now - this.lastRefillTimestamp;

    if (elapsedTime <= 0) {
      this.logger?.trace("No time elapsed since last refill.");
      return; // No refill needed yet
    }

    const newTokens = elapsedTime * this.refillRate;
    const previousTokens = this.tokens;
    this.tokens = Math.min(this.capacity, this.tokens + newTokens);
    this.lastRefillTimestamp = now;

    this.logger?.trace(
      { elapsedTime, newTokens, previousTokens, currentTokens: this.tokens },
      "Tokens refilled."
    );
  }

  async acquire(): Promise<void> {
    this.refillTokens(); // Always check refill first

    if (this.tokens >= 1) {
      this.tokens -= 1; // Consume one token
      this.logger?.trace(
        { tokensRemaining: this.tokens },
        "Token acquired immediately."
      );
      return; // Acquired token without waiting
    }

    // Need to wait for a token
    const waitStart = Date.now();
    this.logger?.debug(
      { tokensAvailable: this.tokens },
      "Waiting for token..."
    ); // Log that we are starting to wait

    while (this.tokens < 1) {
      // Calculate estimated wait time until 1 token is available
      const tokensNeeded = 1 - this.tokens;
      const estimatedWaitMs = Math.ceil(tokensNeeded / this.refillRate);
      // Wait a fraction of the estimated time or a minimum interval to avoid busy-waiting
      const waitTime = Math.max(10, Math.min(estimatedWaitMs / 2, 50)); // Wait between 10ms and 50ms, heuristically

      await new Promise((resolve) => setTimeout(resolve, waitTime));
      this.refillTokens(); // Refill again after waiting
    }

    const waitEnd = Date.now();
    this.tokens -= 1; // Consume one token
    this.logger?.debug(
      { waitedMs: waitEnd - waitStart, tokensRemaining: this.tokens },
      "Token acquired after waiting."
    ); // Log how long we waited
  }
}
