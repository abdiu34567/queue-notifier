export const mockRateLimiter = {
  schedule: jest.fn().mockImplementation(async (fn, ...args) => {
    if (typeof fn !== "function") {
      throw new Error("Mock RateLimiter schedule was not passed a function.");
    }

    return await fn(...args);
  }),
};

export const clearMockRateLimiter = () => {
  mockRateLimiter.schedule.mockClear();
};

export type MockRateLimiter = typeof mockRateLimiter;
