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
