const dummyLogFn = () => {};
const dummyLogger = {
  fatal: dummyLogFn,
  error: dummyLogFn,
  warn: dummyLogFn,
  info: dummyLogFn,
  debug: dummyLogFn,
  trace: dummyLogFn,
  child: jest.fn().mockImplementation(() => dummyLogger),
  setBindings: jest.fn(),
} as any;
jest.mock("../../src/utils/LoggerFactory", () => ({
  loggerFactory: { createLogger: jest.fn().mockReturnValue(dummyLogger) },
}));

const mockRedisGet = jest.fn();
const mockRedisQuit = jest.fn();
const mockRedisInstance = {
  options: { maxRetriesPerRequest: null },
  status: "ready",
  get: mockRedisGet,
  quit: mockRedisQuit,
  on: jest.fn(),
  once: jest.fn(),
  duplicate: jest.fn(() => mockRedisInstance),
  connect: jest.fn().mockResolvedValue(undefined),
} as any;
jest.mock("../../src/utils/RedisHandler", () => ({
  ensureRedisInstance: jest.fn().mockReturnValue(mockRedisInstance),
}));

const mockWorkerOn = jest.fn();
const mockWorkerClose = jest.fn();
const mockQueueClose = jest.fn();
const mockQueueGetJobCounts = jest
  .fn()
  .mockResolvedValue({ active: 0, waiting: 0, delayed: 0 });
const mockQueuePause = jest.fn().mockResolvedValue(undefined);
const mockQueueResume = jest.fn().mockResolvedValue(undefined);
jest.mock("bullmq", () => ({
  Worker: jest.fn().mockImplementation((queueName, processor, options) => ({
    on: mockWorkerOn,
    close: mockWorkerClose,
  })),
  Queue: jest.fn().mockImplementation((queueName, options) => ({
    close: mockQueueClose,
    getJobCounts: mockQueueGetJobCounts,
    pause: mockQueuePause,
    resume: mockQueueResume,
  })),
}));

const mockNotifierSend = jest.fn();
const mockNotifier = { send: mockNotifierSend };
const mockNotifierRegistryGet = jest.fn();
jest.mock("../../src/core/NotifierRegistry", () => ({
  NotifierRegistry: {
    get: mockNotifierRegistryGet,
  },
}));

const mockTrackNotificationResponse = jest.fn();
const mockGetNotificationStats = jest.fn();
jest.mock("../../src/utils/ResponseTrackers", () => ({
  trackNotificationResponse: mockTrackNotificationResponse,
  getNotificationStats: mockGetNotificationStats,
}));

jest.mock("../../src/utils/RedisHandler", () => ({
  ensureRedisInstance: jest.fn().mockReturnValue(mockRedisInstance),
}));

import {
  WorkerManager,
  WorkerManagerConfig,
} from "../../src/core/WorkerManager";
import { Job, Queue, Worker } from "bullmq";
import Redis, { RedisOptions } from "ioredis";
import { ensureRedisInstance } from "../../src/utils/RedisHandler";

describe("WorkerManager", () => {
  const baseConfig = {
    redisConnection: mockRedisInstance as Redis,
    queueName: "test-queue",
    concurrency: 5,
    trackingKey: "test:stats",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockNotifierRegistryGet.mockReturnValue(mockNotifier);
    mockRedisGet.mockResolvedValue(null);
    mockNotifierSend.mockResolvedValue([
      { status: "success", recipient: "r1" },
    ]);
  });

  test("should initialize Redis, Queue, and Worker correctly", () => {
    const workerManager = new WorkerManager(baseConfig);

    expect(ensureRedisInstance).toHaveBeenCalledWith(
      baseConfig.redisConnection,
      expect.any(Object)
    );
    expect(Queue).toHaveBeenCalledWith(baseConfig.queueName, {
      connection: mockRedisInstance,
    });
    expect(Worker).toHaveBeenCalledWith(
      baseConfig.queueName,
      expect.any(Function),
      expect.objectContaining({
        connection: mockRedisInstance,
        concurrency: baseConfig.concurrency,
      })
    );
    expect(mockWorkerOn).toHaveBeenCalledWith("active", expect.any(Function));
    expect(mockWorkerOn).toHaveBeenCalledWith(
      "completed",
      expect.any(Function)
    );
    expect(mockWorkerOn).toHaveBeenCalledWith("failed", expect.any(Function));
    expect(mockWorkerOn).toHaveBeenCalledWith("drained", expect.any(Function));
  });

  test("should merge bullWorkerOptions into Worker options", () => {
    const specificWorkerOpts = {
      lockDuration: 30000,
      limiter: { max: 100, duration: 1000 },
    };
    const configWithBullOpts = {
      ...baseConfig,
      bullWorkerOptions: specificWorkerOpts,
    };
    const workerManager = new WorkerManager(configWithBullOpts);

    expect(Worker).toHaveBeenCalledWith(
      configWithBullOpts.queueName,
      expect.any(Function),
      expect.objectContaining({
        connection: mockRedisInstance,
        concurrency: configWithBullOpts.concurrency,
        ...specificWorkerOpts,
      })
    );
  });

  const getProcessorFunction = (
    manager: WorkerManager
  ): ((job: Job) => Promise<void>) => {
    const workerArgs = (Worker as any).mock.calls[0];
    return workerArgs[1];
  };

  test("jobProcessor should call notifier.send for valid job", async () => {
    const jobData = {
      userIds: ["u1", "u2"],
      channel: "email",
      meta: [{}, {}],
      trackingKey: "tk1",
    };
    const mockJob = { id: "job1", name: "send-email", data: jobData } as Job;
    const workerManager = new WorkerManager(baseConfig);
    const processor = getProcessorFunction(workerManager);

    await processor(mockJob);

    expect(mockNotifierRegistryGet).toHaveBeenCalledWith("email");
    expect(mockNotifierSend).toHaveBeenCalledTimes(1);
    expect(mockNotifierSend).toHaveBeenCalledWith(
      ["u1", "u2"],
      [{}, {}],
      expect.any(Object)
    );
    expect(mockTrackNotificationResponse).not.toHaveBeenCalled();
  });

  test("jobProcessor should handle cancellation flag", async () => {
    const jobData = {
      userIds: ["u1"],
      channel: "firebase",
      meta: [{}],
      campaignId: "cancel-me",
    };
    const mockJob = { id: "job2", name: "send-fcm", data: jobData } as Job;
    mockRedisGet.mockResolvedValue("true");

    const workerManager = new WorkerManager(baseConfig);
    const processor = getProcessorFunction(workerManager);

    await processor(mockJob);

    expect(mockRedisGet).toHaveBeenCalledWith(
      "worker:cancel:campaign:cancel-me"
    );
    expect(mockNotifierRegistryGet).not.toHaveBeenCalled();
    expect(mockNotifierSend).not.toHaveBeenCalled();
  });

  test("jobProcessor should call tracker if trackResponses is true", async () => {
    const jobData = {
      userIds: ["u3"],
      channel: "webpush",
      meta: [{}],
      trackResponses: true,
      trackingKey: "webstats",
    };
    const mockJob = { id: "job3", name: "send-web", data: jobData } as Job;
    const mockResponse = [{ status: "success", recipient: "u3", response: {} }];
    mockNotifierSend.mockResolvedValue(mockResponse);
    const workerManager = new WorkerManager(baseConfig);
    const processor = getProcessorFunction(workerManager);

    await processor(mockJob);

    expect(mockNotifierSend).toHaveBeenCalledTimes(1);
    expect(mockTrackNotificationResponse).toHaveBeenCalledTimes(1);
    expect(mockTrackNotificationResponse).toHaveBeenCalledWith(
      mockRedisInstance,
      "webstats",
      mockResponse,
      expect.any(Object)
    );
  });

  test("jobProcessor should throw and track error if notifier.send fails", async () => {
    const jobData = {
      userIds: ["u4"],
      channel: "sms",
      meta: [{}],
      trackResponses: true,
      trackingKey: "smsstats",
    };
    const mockJob = { id: "job4", name: "send-sms", data: jobData } as Job;
    const sendError = new Error("SMS Gateway Timeout");
    mockNotifierSend.mockRejectedValue(sendError);
    const workerManager = new WorkerManager(baseConfig);
    const processor = getProcessorFunction(workerManager);

    await expect(processor(mockJob)).rejects.toThrow(sendError);

    expect(mockNotifierSend).toHaveBeenCalledTimes(1);
    expect(mockTrackNotificationResponse).toHaveBeenCalledTimes(1);
    expect(mockTrackNotificationResponse).toHaveBeenCalledWith(
      mockRedisInstance,
      "smsstats",
      { success: false, error: "SMS Gateway Timeout" },
      expect.any(Object)
    );
  });

  test("jobProcessor should throw if userIds is not an array", async () => {
    const jobData = { userIds: "not-an-array", channel: "email", meta: [] };
    const mockJob = { id: "job5", name: "bad-job", data: jobData } as Job;
    const workerManager = new WorkerManager(baseConfig);
    const processor = getProcessorFunction(workerManager);

    await expect(processor(mockJob)).rejects.toThrow(
      "Invalid userIds data in job job5"
    );
    expect(mockNotifierRegistryGet).not.toHaveBeenCalled();
  });

  test("close should call worker.close and queue.close", async () => {
    const workerManager = new WorkerManager(baseConfig);
    await workerManager.close();
    expect(mockWorkerClose).toHaveBeenCalledTimes(1);
    expect(mockQueueClose).toHaveBeenCalledTimes(1);
  });

  test("close should call redis.quit if it owns the connection", async () => {
    const configOwns: WorkerManagerConfig = {
      ...baseConfig,
      redisConnection: { host: "localhost", port: 6379 } as RedisOptions,
    };

    const workerManager = new WorkerManager(configOwns);
    expect((workerManager as any).ownsRedisConnection).toBe(true);

    mockRedisInstance.status = "ready";
    await workerManager.close();

    expect(mockRedisQuit).toHaveBeenCalledTimes(1);
    expect(ensureRedisInstance).toHaveBeenCalledWith(
      configOwns.redisConnection,
      expect.any(Object)
    );
  });

  test("close should NOT call redis.quit if it does not own the connection", async () => {
    const workerManager = new WorkerManager(baseConfig);
    (workerManager as any).ownsRedisConnection = false;
    (workerManager as any).redisInstance = mockRedisInstance;

    await workerManager.close();
    expect(mockRedisQuit).not.toHaveBeenCalled();
  });
});
