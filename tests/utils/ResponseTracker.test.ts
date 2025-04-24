import Redis from "ioredis";

const dummyLogFn = () => {};
const mockLogError = jest.fn();
const mockLogWarn = jest.fn();
const mockLogInfo = jest.fn();
const mockLogDebug = jest.fn();
const mockLogTrace = jest.fn();
const dummySilentLogger = {
  fatal: jest.fn(),
  error: mockLogError,
  warn: mockLogWarn,
  info: mockLogInfo,
  debug: mockLogDebug,
  trace: mockLogTrace,
  child: jest.fn().mockImplementation(() => dummySilentLogger),
  setBindings: jest.fn(),
  level: "silent",
} as any;
jest.mock("../../src/utils/LoggerFactory", () => ({
  __esModule: true,
  loggerFactory: {
    createLogger: jest.fn().mockReturnValue(dummySilentLogger),
  },
}));

const mockHincrby = jest.fn();
const mockHgetall = jest.fn();
const mockDel = jest.fn();
const mockPipelineExec = jest.fn().mockResolvedValue([]);
const mockPipeline = {
  hincrby: mockHincrby,
  exec: mockPipelineExec,
};
const mockRedisInstance = {
  pipeline: jest.fn(() => mockPipeline),
  hgetall: mockHgetall,
  del: mockDel,
} as unknown as Redis;

import {
  trackNotificationResponse,
  getNotificationStats,
  resetNotificationStats,
} from "../../src/utils/ResponseTrackers";
import { NotificationResult } from "../../src/jobs/channels/NotificationChannel";

describe("ResponseTrackers", () => {
  const trackingKey = "test:stats:key";
  const mockRedis = mockRedisInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockHincrby.mockClear();
    mockPipelineExec.mockClear();
  });

  describe("trackNotificationResponse", () => {
    test("should increment success count for successful results in array", async () => {
      const responses: NotificationResult[] = [
        { status: "success", recipient: "u1" },
        { status: "success", recipient: "u2" },
      ];
      await trackNotificationResponse(
        mockRedis,
        trackingKey,
        responses,
        dummySilentLogger
      );

      expect(mockRedis.pipeline).toHaveBeenCalledTimes(1);
      expect(mockHincrby).toHaveBeenCalledTimes(2);
      expect(mockHincrby).toHaveBeenCalledWith(trackingKey, "success", 1);
      expect(mockPipelineExec).toHaveBeenCalledTimes(1);
    });

    test("should increment specific error counts for failed results in array", async () => {
      const responses: NotificationResult[] = [
        { status: "error", recipient: "u3", error: "RATE_LIMIT" },
        { status: "success", recipient: "u4" },
        {
          status: "error",
          recipient: "u5",
          error: "INVALID_TOKEN:Some_detail",
        },
        { status: "error", recipient: "u6", error: "RATE_LIMIT" },
      ];
      await trackNotificationResponse(
        mockRedis,
        trackingKey,
        responses,
        dummySilentLogger
      );

      expect(mockRedis.pipeline).toHaveBeenCalledTimes(1);
      expect(mockHincrby).toHaveBeenCalledTimes(4);
      expect(mockHincrby).toHaveBeenCalledWith(trackingKey, "success", 1);
      expect(mockHincrby).toHaveBeenCalledWith(
        trackingKey,
        "error:RATE_LIMIT",
        1
      );
      expect(mockHincrby).toHaveBeenCalledWith(
        trackingKey,
        "error:INVALID_TOKEN:Some_detail",
        1
      );
      expect(mockHincrby).toHaveBeenCalledWith(
        trackingKey,
        "error:RATE_LIMIT",
        1
      );
      expect(mockPipelineExec).toHaveBeenCalledTimes(1);
      const rateLimitCalls = mockHincrby.mock.calls.filter(
        (call) => call[1] === "error:RATE_LIMIT"
      );
      expect(rateLimitCalls).toHaveLength(2);
    });

    test("should increment unknown error if error field is missing/empty in failed result", async () => {
      const responses: NotificationResult[] = [
        { status: "error", recipient: "u7", error: "" },
        { status: "error", recipient: "u8" },
      ];
      await trackNotificationResponse(
        mockRedis,
        trackingKey,
        responses,
        dummySilentLogger
      );

      expect(mockHincrby).toHaveBeenCalledTimes(2);
      expect(mockHincrby).toHaveBeenCalledWith(
        trackingKey,
        "error:UNKNOWN_ERROR",
        1
      );
      expect(mockPipelineExec).toHaveBeenCalledTimes(1);
    });

    test("should increment error count for single overall failure object", async () => {
      const response = { success: false, error: "GLOBAL_TIMEOUT" };
      await trackNotificationResponse(
        mockRedis,
        trackingKey,
        response,
        dummySilentLogger
      );

      expect(mockRedis.pipeline).toHaveBeenCalledTimes(1);
      expect(mockHincrby).toHaveBeenCalledTimes(1);
      expect(mockHincrby).toHaveBeenCalledWith(
        trackingKey,
        "error:GLOBAL_TIMEOUT",
        1
      );
      expect(mockPipelineExec).toHaveBeenCalledTimes(1);
    });

    test("should increment invalid format count for unexpected response type", async () => {
      const response = { some: "weird", object: true }; // Unexpected format
      await trackNotificationResponse(
        mockRedis,
        trackingKey,
        response,
        dummySilentLogger
      );

      expect(mockRedis.pipeline).toHaveBeenCalledTimes(1);
      expect(mockHincrby).toHaveBeenCalledTimes(1);
      expect(mockHincrby).toHaveBeenCalledWith(
        trackingKey,
        "error:invalid_response_format",
        1
      );
      expect(mockPipelineExec).toHaveBeenCalledTimes(1);
    });

    test("should not call pipeline.exec if response is empty or invalid", async () => {
      await trackNotificationResponse(
        mockRedis,
        trackingKey,
        [],
        dummySilentLogger
      );
      expect(mockPipelineExec).not.toHaveBeenCalled();

      await trackNotificationResponse(
        mockRedis,
        trackingKey,
        null,
        dummySilentLogger
      );
      expect(mockPipelineExec).not.toHaveBeenCalled();
    });

    test("should handle Redis errors gracefully without throwing", async () => {
      const responses: NotificationResult[] = [
        { status: "success", recipient: "u1" },
      ];
      const redisError = new Error("Redis unavailable");
      mockPipelineExec.mockRejectedValueOnce(redisError);

      await expect(
        trackNotificationResponse(
          mockRedis,
          trackingKey,
          responses,
          dummySilentLogger
        )
      ).resolves.toBeUndefined();

      expect(mockRedis.pipeline).toHaveBeenCalledTimes(1);
      expect(mockHincrby).toHaveBeenCalledTimes(1);
      expect(mockPipelineExec).toHaveBeenCalledTimes(1);
    });
  });

  describe("getNotificationStats", () => {
    test("should call redis.hgetall with the correct key", async () => {
      const expectedStats = { success: "10", "error:SOME_ERROR": "2" };
      mockHgetall.mockResolvedValueOnce(expectedStats);

      const stats = await getNotificationStats(
        mockRedis,
        trackingKey,
        dummySilentLogger
      );

      expect(mockHgetall).toHaveBeenCalledTimes(1);
      expect(mockHgetall).toHaveBeenCalledWith(trackingKey);
      expect(stats).toEqual(expectedStats);
    });

    test("should use default tracking key if none provided", async () => {
      mockHgetall.mockResolvedValueOnce({});
      await getNotificationStats(mockRedis, undefined, dummySilentLogger);
      expect(mockHgetall).toHaveBeenCalledWith("notifications:stats");
    });

    test("should return empty object if redis.hgetall fails", async () => {
      const redisError = new Error("Redis unavailable");
      mockHgetall.mockRejectedValueOnce(redisError);

      const stats = await getNotificationStats(
        mockRedis,
        trackingKey,
        dummySilentLogger
      );

      expect(mockHgetall).toHaveBeenCalledTimes(1);
      expect(stats).toEqual({});
    });
  });

  describe("resetNotificationStats", () => {
    test("should call redis.del with the correct key", async () => {
      mockDel.mockResolvedValueOnce(1);

      await resetNotificationStats(mockRedis, trackingKey, dummySilentLogger);

      expect(mockDel).toHaveBeenCalledTimes(1);
      expect(mockDel).toHaveBeenCalledWith(trackingKey);
    });

    test("should use default tracking key if none provided", async () => {
      mockDel.mockResolvedValueOnce(1);
      await resetNotificationStats(mockRedis, undefined, dummySilentLogger);
      expect(mockDel).toHaveBeenCalledWith("notifications:stats");
    });

    test("should handle Redis errors gracefully without throwing", async () => {
      const redisError = new Error("Redis unavailable");
      mockDel.mockRejectedValueOnce(redisError);

      await expect(
        resetNotificationStats(mockRedis, trackingKey, dummySilentLogger)
      ).resolves.toBeUndefined();

      expect(mockDel).toHaveBeenCalledTimes(1);
    });
  });
});
