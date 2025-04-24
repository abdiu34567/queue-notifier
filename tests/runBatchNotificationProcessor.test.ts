const dummyLogger: any = {
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
  warn: jest.fn(),
  child: jest.fn().mockReturnThis(),
};
jest.mock("../src/utils/LoggerFactory", () => ({
  __esModule: true,
  loggerFactory: { createLogger: jest.fn(() => dummyLogger) },
}));

jest.mock("../src/utils/RedisHandler", () => ({
  __esModule: true,
  ensureRedisInstance: jest.fn((conn: any) => {
    return conn;
  }),
}));

const processInBatchesMock = jest.fn();
const retryWithBackoffMock = jest.fn((fn: any) => fn());
jest.mock("../src/core/BatchProcessor", () => ({
  __esModule: true,
  processInBatches: processInBatchesMock,
  retryWithBackoff: retryWithBackoffMock,
}));

const enqueueJobMock = jest.fn();
jest.mock("../src/core/QueueManager", () => ({
  __esModule: true,
  QueueManager: {
    enqueueJob: enqueueJobMock,
  },
}));

const acquireMock = jest.fn();
jest.mock("../src/core/RateLimiter", () => ({
  __esModule: true,
  TokenBucketRateLimiter: jest
    .fn()
    .mockImplementation(() => ({ acquire: acquireMock })),
}));

import { dispatchNotifications } from "../src/runBatchNotificationProcessor";
import { loggerFactory } from "../src/utils/LoggerFactory";
import { ensureRedisInstance } from "../src/utils/RedisHandler";
import { processInBatches, retryWithBackoff } from "../src/core/BatchProcessor";
import { QueueManager } from "../src/core/QueueManager";
import { TokenBucketRateLimiter } from "../src/core/RateLimiter";
import Redis from "ioredis";
import type { JobsOptions } from "bullmq";

describe("dispatchNotifications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("throws when Redis initialization fails", async () => {
    (ensureRedisInstance as jest.Mock).mockImplementationOnce(() => {
      throw new Error("bad redis");
    });

    await expect(
      dispatchNotifications({
        redisConnection: {},
        channelName: "email",
        dbQuery: jest.fn(),
        mapRecordToUserId: jest.fn(),
        meta: jest.fn(),
        queueName: "q",
        jobName: "j",
      } as any)
    ).rejects.toThrow("Failed to initialize Redis: bad redis");
    expect(dummyLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Failed to initialize Redis connection."
    );
  });

  it("processes no records when dbQuery returns empty array", async () => {
    (ensureRedisInstance as jest.Mock).mockReturnValue({ status: "ready" });
    processInBatchesMock.mockImplementationOnce(
      async (_fetch, _process, logger, _opts) => {}
    );

    await dispatchNotifications({
      redisConnection: {},
      channelName: "telegram",
      dbQuery: jest.fn().mockResolvedValue([]),
      mapRecordToUserId: jest.fn(),
      meta: jest.fn(),
      queueName: "queue",
      jobName: "job",
    } as any);

    expect(processInBatchesMock).toHaveBeenCalled();
    expect(dummyLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ready" }),
      "Checking status of internally created Redis connection for cleanup."
    );
  });

  it("enqueues jobs for records", async () => {
    const records = [
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ];
    const dbQueryMock = jest.fn().mockResolvedValue(records);
    const mapMock = jest.fn((r) => `user-${r.id}`);
    const metaMock = jest.fn((r: any) => ({
      from: "noreply@example.com",
      to: `user-${r.id}@example.com`,
      subject: `Title-${r.name}`,
      html: `<p>Record ${r.id}</p>`,
    })) as any;
    (ensureRedisInstance as jest.Mock).mockReturnValue({
      status: "ready",
      quit: jest.fn(),
    });

    (processInBatches as jest.Mock).mockImplementation(
      async (fetchFn, processFn) => {
        const recs = await fetchFn(0, undefined);
        await processFn(recs);
      }
    );

    await dispatchNotifications({
      redisConnection: {},
      channelName: "email",
      dbQuery: dbQueryMock,
      mapRecordToUserId: mapMock,
      meta: metaMock,
      queueName: "Q",
      jobName: "J",
      maxQueriesPerSecond: 2,
      trackResponses: true,
      trackingKey: "TK",
      campaignId: "CID",
      jobOptions: { attempts: 5 } as JobsOptions,
    });

    expect(acquireMock).toHaveBeenCalled();

    expect(retryWithBackoffMock).toHaveBeenCalled();

    expect(enqueueJobMock).toHaveBeenCalledWith(
      { status: "ready", quit: expect.any(Function) },
      "Q",
      "J",
      expect.objectContaining({
        userIds: ["user-1", "user-2"],
        channel: "email",
        meta: [
          expect.objectContaining({
            subject: "Title-A",
            to: "user-1@example.com",
          }),
          expect.objectContaining({
            subject: "Title-B",
            to: "user-2@example.com",
          }),
        ],
        trackResponses: true,
        trackingKey: "TK",
        campaignId: "CID",
      }),
      dummyLogger,
      expect.objectContaining({
        attempts: 5,
        removeOnComplete: true,
        removeOnFail: false,
      })
    );
  });

  it("skips quit when external Redis instance provided", async () => {
    const extRedis = Object.create(Redis.prototype) as Redis;
    extRedis.status = "connect";
    extRedis.quit = jest.fn().mockResolvedValue(undefined);
    (ensureRedisInstance as jest.Mock).mockReturnValue(extRedis);
    (processInBatches as jest.Mock).mockResolvedValue(undefined);

    await dispatchNotifications({
      redisConnection: extRedis,
      channelName: "web",
      dbQuery: jest.fn().mockResolvedValue([]),
      mapRecordToUserId: jest.fn(),
      meta: jest.fn(),
      queueName: "Q",
      jobName: "J",
    } as any);

    expect(dummyLogger.debug).toHaveBeenCalledWith(
      "External Redis connection provided, skipping cleanup."
    );
  });
});
