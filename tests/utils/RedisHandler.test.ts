import Redis, { RedisOptions } from "ioredis";

const dummyLogFn = () => {};
const dummyLogger = {
  fatal: dummyLogFn,
  error: jest.fn(dummyLogFn),
  warn: jest.fn(dummyLogFn),
  info: jest.fn(dummyLogFn),
  debug: jest.fn(dummyLogFn),
  trace: jest.fn(dummyLogFn),
  child: jest.fn().mockImplementation(() => dummyLogger),
} as any;

const mockRedisConstructor = jest.fn();
const mockRedisInstanceMethods = {
  options: {},
  status: "ready",
  on: jest.fn(),
  once: jest.fn(),
  quit: jest.fn(),
};
jest.mock("ioredis", () => {
  return jest.fn().mockImplementation((options?: RedisOptions | string) => {
    mockRedisConstructor(options);
    return {
      ...mockRedisInstanceMethods,
      options:
        typeof options === "string"
          ? { connectionString: options }
          : { ...options },
    };
  });
});

import { ensureRedisInstance } from "../../src/utils/RedisHandler";

describe("ensureRedisInstance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisInstanceMethods.options = {};
  });

  test("should create new instance with defaults if options are provided", () => {
    const userOptions: RedisOptions = { host: "localhost", port: 6380 };
    const expectedMergedOptions = {
      ...userOptions,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    };

    const result = ensureRedisInstance(userOptions, dummyLogger);

    expect(mockRedisConstructor).toHaveBeenCalledTimes(1);
    expect(mockRedisConstructor).toHaveBeenCalledWith(expectedMergedOptions);
    expect(result.options).toEqual(expectedMergedOptions);
    expect(dummyLogger.info).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining("Creating new Redis instance")
    );
    expect(dummyLogger.error).not.toHaveBeenCalled();
  });

  test("should create new instance honoring user options over defaults", () => {
    const userOptions: RedisOptions = {
      host: "cache.server",
      maxRetriesPerRequest: 5,
      enableReadyCheck: true,
    };
    const expectedMergedOptions = {
      ...userOptions,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    };

    const result = ensureRedisInstance(userOptions, dummyLogger);

    expect(mockRedisConstructor).toHaveBeenCalledTimes(1);
    expect(mockRedisConstructor).toHaveBeenCalledWith(expectedMergedOptions);
    expect(result.options).toEqual(expectedMergedOptions);
    expect(dummyLogger.info).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining("Creating new Redis instance")
    );
    expect(dummyLogger.error).not.toHaveBeenCalled();
    expect(dummyLogger.warn).not.toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining("enableReadyCheck")
    );
  });

  test("should throw if creating new instance fails", () => {
    const userOptions: RedisOptions = { host: "badhost" };
    const creationError = new Error("getaddrinfo ENOTFOUND badhost");
    mockRedisConstructor.mockImplementationOnce(() => {
      throw creationError;
    });

    expect(() => {
      ensureRedisInstance(userOptions, dummyLogger);
    }).toThrow(`Failed to create Redis instance: ${creationError.message}`);

    expect(mockRedisConstructor).toHaveBeenCalledTimes(1);
    expect(dummyLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: creationError }),
      expect.stringContaining("Failed to create Redis instance from options")
    );
  });

  test.each([[null], [undefined], [123], ["redis://string"], [true]])(
    "should throw if input is not an instance or options object (input: %p)",
    (invalidInput) => {
      expect(() => {
        ensureRedisInstance(invalidInput as any, dummyLogger);
      }).toThrow(
        "Invalid redisConnection provided: Must be an ioredis instance or RedisOptions object."
      );

      expect(dummyLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ providedType: typeof invalidInput }),
        expect.stringContaining("Invalid redisConnection provided")
      );
    }
  );
});
