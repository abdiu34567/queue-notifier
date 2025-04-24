const dummyLogFn = () => {};
const dummyLogger = {
  fatal: dummyLogFn,
  error: dummyLogFn,
  warn: dummyLogFn,
  info: dummyLogFn,
  debug: dummyLogFn,
  trace: dummyLogFn,
  child: jest.fn().mockImplementation(() => dummyLogger),
} as any;
const mockQueueAdd = jest.fn();
const mockQueueClose = jest.fn();

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation((queueName, options) => {
    return {
      add: mockQueueAdd,
      close: mockQueueClose,
    };
  }),
}));

const mockRedisConnection = {
  options: {},
  status: "ready",
  duplicate: jest.fn(() => mockRedisConnection),
} as any;

import { QueueManager } from "../../src/core/QueueManager";
import { JobsOptions, Queue } from "bullmq";

describe("QueueManager", () => {
  beforeEach(() => {
    mockQueueAdd.mockClear();
    mockQueueClose.mockClear();
    (Queue as any).mockClear();
  });

  test("should create a Queue instance with correct name and connection", async () => {
    const queueName = "test-queue-1";
    const jobName = "test-job";
    const jobData = {
      userIds: ["u1"],
      channel: "test",
      meta: [],
      trackingKey: "k1",
    };

    const mockJob = { id: "temp-job-id", name: jobName, data: jobData };
    mockQueueAdd.mockResolvedValue(mockJob);

    await QueueManager.enqueueJob(
      mockRedisConnection,
      queueName,
      jobName,
      jobData,
      dummyLogger
    );

    expect(Queue).toHaveBeenCalledTimes(1);
    expect(Queue).toHaveBeenCalledWith(queueName, {
      connection: mockRedisConnection,
    });

    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
  });

  test("should call queue.add with correct job name, data, and options", async () => {
    const queueName = "test-queue-2";
    const jobName = "process-image";
    const jobData = {
      userIds: ["u1", "u2"],
      channel: "image",
      meta: [{}, {}],
      trackingKey: "k2",
      campaignId: "c1",
    };
    const jobOptions: JobsOptions = {
      delay: 5000,
      attempts: 3,
      removeOnComplete: true,
    };

    const mockJob = { id: "job-123", name: jobName, data: jobData };
    mockQueueAdd.mockResolvedValue(mockJob);

    await QueueManager.enqueueJob(
      mockRedisConnection,
      queueName,
      jobName,
      jobData,
      dummyLogger,
      jobOptions
    );

    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    expect(mockQueueAdd).toHaveBeenCalledWith(jobName, jobData, jobOptions);
  });

  test("should call queue.add with correct job name and data when options are undefined", async () => {
    const queueName = "test-queue-3";
    const jobName = "send-welcome";
    const jobData = {
      userIds: ["u3"],
      channel: "email",
      meta: [{ sub: "Welcome" }],
      trackingKey: "k3",
    };

    const mockJob = { id: "job-456", name: jobName, data: jobData };
    mockQueueAdd.mockResolvedValue(mockJob);

    await QueueManager.enqueueJob(
      mockRedisConnection,
      queueName,
      jobName,
      jobData,
      dummyLogger,
      undefined
    );

    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    expect(mockQueueAdd).toHaveBeenCalledWith(jobName, jobData, undefined); // Check options are undefined
  });

  test("should throw error if queue.add fails", async () => {
    const queueName = "test-queue-fail";
    const jobName = "fail-job";
    const jobData = {
      userIds: ["u4"],
      channel: "test",
      meta: [],
      trackingKey: "kf",
    };
    const addError = new Error("Redis connection lost");

    mockQueueAdd.mockRejectedValue(addError);

    await expect(
      QueueManager.enqueueJob(
        mockRedisConnection,
        queueName,
        jobName,
        jobData,
        dummyLogger
      )
    ).rejects.toThrow(addError);

    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    expect(mockQueueAdd).toHaveBeenCalledWith(jobName, jobData, undefined);
  });

  test("should not call queue.close", async () => {
    const queueName = "test-queue-noclose";
    const jobName = "noclose-job";
    const jobData = {
      userIds: ["u5"],
      channel: "test",
      meta: [],
      trackingKey: "knc",
    };

    const mockJob = { id: "job-789", name: jobName, data: jobData };
    mockQueueAdd.mockResolvedValue(mockJob);

    await QueueManager.enqueueJob(
      mockRedisConnection,
      queueName,
      jobName,
      jobData,
      dummyLogger
    );

    expect(mockQueueClose).not.toHaveBeenCalled();
  });
});
