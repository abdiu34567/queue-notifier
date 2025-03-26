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

// Overwrite QueueManager's internal queue storage for testing
// (QueueManager as any).queues = new Map();
// (QueueManager as any).queues.set("enqueueTest", new FakeQueue());

interface NotificationJobData {
  userIds: string[];
  channel: string;
  meta: any[];
  trackResponses?: boolean;
  trackingKey: string;
  delay?: number;
}

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

    // Provide a valid NotificationJobData object
    const jobData: NotificationJobData = {
      userIds: ["user1"],
      channel: "telegram",
      meta: [{ text: "hello" }],
      trackingKey: "notifications:stats",
      // trackResponses is optional, delay is optional
    };

    await QueueManager.enqueueJob(queueName, jobName, jobData);

    expect(FakeQueue).toHaveBeenCalledWith(queueName, { connection: {} });
    expect(addMock).toHaveBeenCalledWith(jobName, jobData, {
      delay: jobData.delay, // will be undefined if not provided
      removeOnComplete: true,
      removeOnFail: false,
    });
  });

  //   it("should enqueue a job successfully", async () => {
  //     const queueName = "enqueueTest";
  //     const jobName = "jobTest";
  //     const jobData = { foo: "bar" };

  //     await QueueManager.enqueueJob(queueName, jobName, jobData);

  //     expect(FakeQueue).toHaveBeenCalledWith(queueName, { connection: {} });
  //     expect(addMock).toHaveBeenCalledWith(jobName, jobData, {
  //       removeOnComplete: true,
  //       removeOnFail: false,
  //     });
  //   });
});
