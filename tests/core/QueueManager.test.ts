jest.mock("../../src/utils/RedisClient", () => ({
  RedisClient: {
    getInstance: jest.fn(() => ({})),
    setInstance: jest.fn(),
  },
}));

const addMock = jest.fn().mockResolvedValue("jobId");
const FakeQueue = jest
  .fn()
  .mockImplementation((queueName: string, options: any) => ({
    queueName,
    options,
    add: addMock,
  }));

// Mock the bullmq module so that Queue is replaced by our FakeQueue
jest.mock("bullmq", () => ({
  Queue: FakeQueue,
}));

import { QueueManager } from "../../src/core/QueueManager";

describe("QueueManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should create a new queue if it does not exist", () => {
    const queueName = "testQueue";
    const queue = QueueManager.createQueue(queueName);

    expect(queue).toBeDefined();
    expect(FakeQueue).toHaveBeenCalledWith(queueName, { connection: {} });
  });

  it("should return the same queue if already created", () => {
    const queueName = "sameQueue";
    const firstQueue = QueueManager.createQueue(queueName);
    const secondQueue = QueueManager.createQueue(queueName);

    expect(firstQueue).toBe(secondQueue);
    expect(FakeQueue).toHaveBeenCalledTimes(1);
  });

  it("should enqueue a job successfully", async () => {
    const queueName = "enqueueTest";
    const jobName = "jobTest";
    const jobData = { foo: "bar" };

    await QueueManager.enqueueJob(queueName, jobName, jobData);

    expect(FakeQueue).toHaveBeenCalledWith(queueName, { connection: {} });
    expect(addMock).toHaveBeenCalledWith(jobName, jobData, {
      removeOnComplete: true,
      removeOnFail: false,
    });
  });
});
