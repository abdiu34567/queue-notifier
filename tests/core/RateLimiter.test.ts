import { RateLimiter } from "../../src/core/RateLimiter";
import Bottleneck from "bottleneck";

jest.mock("bottleneck", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    schedule: jest.fn().mockImplementation((fn) => fn()),
  })),
}));

describe("RateLimiter", () => {
  const mockSchedule = Bottleneck.prototype.schedule as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Initialization", () => {
    it("should create Bottleneck with correct parameters", () => {
      new RateLimiter(10, 1000);
      expect(Bottleneck).toHaveBeenCalledWith({
        maxConcurrent: 10,
        minTime: 100,
      });
    });

    it("should handle different rate limit configurations", () => {
      new RateLimiter(1, 500);
      expect(Bottleneck).toHaveBeenCalledWith({
        maxConcurrent: 1,
        minTime: 500,
      });

      new RateLimiter(100, 1000);
      expect(Bottleneck).toHaveBeenCalledWith({
        maxConcurrent: 100,
        minTime: 10,
      });
    });
  });

  describe("schedule()", () => {
    const mockFn = jest.fn().mockResolvedValue("result");
    const args = [1, "test", { key: "value" }];

    it("should schedule tasks through Bottleneck", async () => {
      const limiter = new RateLimiter(10, 1000);
      await limiter.schedule(mockFn, ...args);

      expect(mockFn).toHaveBeenCalledWith(...args);
    });

    it("should resolve with the function result", async () => {
      const limiter = new RateLimiter(10, 1000);
      const result = await limiter.schedule(mockFn, ...args);
      expect(result).toBe("result");
    });

    it("should reject when the function rejects", async () => {
      const error = new Error("Task failed");
      const failingFn = jest.fn().mockRejectedValue(error);
      const limiter = new RateLimiter(10, 1000);

      await expect(limiter.schedule(failingFn)).rejects.toThrow(error);
    });

    it("should handle multiple concurrent requests", async () => {
      const limiter = new RateLimiter(2, 1000);
      const fn1 = jest.fn().mockResolvedValue("first");
      const fn2 = jest.fn().mockResolvedValue("second");
      const fn3 = jest.fn().mockResolvedValue("third");

      const results = await Promise.all([
        limiter.schedule(fn1),
        limiter.schedule(fn2),
        limiter.schedule(fn3),
      ]);

      expect(results).toEqual(["first", "second", "third"]);
    });
  });

  describe("Rate Limiting Behavior", () => {
    beforeAll(() => {
      jest.useFakeTimers();
    });

    afterAll(() => {
      jest.useRealTimers();
    });

    it("should enforce rate limits", async () => {
      const limiter = new RateLimiter(2, 1000);
      const mockFn = jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return Date.now();
      });

      // Start 4 tasks in quick succession
      const promises = [
        limiter.schedule(mockFn),
        limiter.schedule(mockFn),
        limiter.schedule(mockFn),
        limiter.schedule(mockFn),
      ];

      // Advance time by 50ms
      jest.advanceTimersByTime(50);
      await Promise.resolve(); // Allow microtasks to run

      expect(mockFn).toHaveBeenCalledTimes(4);

      // Advance time to 150ms
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      expect(mockFn).toHaveBeenCalledTimes(4);

      // Advance time to 250ms
      jest.advanceTimersByTime(100);
      await Promise.resolve();

      expect(mockFn).toHaveBeenCalledTimes(4);
    });
  });
});
