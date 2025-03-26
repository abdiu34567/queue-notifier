import { Queue } from "bullmq";
import { QueueManager } from "../../src/core/QueueManager";
import { RedisClient } from "../../src/utils/RedisClient";

// Define an interface for our job data (if not already defined)
interface NotificationJobData {
  userIds: string[];
  channel: string;
  meta: any[];
  trackResponses: boolean;
  trackingKey: string;
  delay?: number;
}

// Mock the Redis client to avoid actual connections.
jest.mock("../../src/utils/RedisClient", () => ({
  RedisClient: {
    getInstance: jest.fn(() => ({ options: {} })),
    setInstance: jest.fn(),
  },
}));

describe("QueueManager.enqueueJob with scheduling", () => {
  let fakeQueueAdd: jest.Mock;
  let fakeQueue: Partial<Queue>;

  beforeEach(() => {
    // Create a fake queue with a mocked add method.
    fakeQueueAdd = jest.fn().mockResolvedValue(null);
    fakeQueue = {
      add: fakeQueueAdd,
    };

    // Reset the internal queues Map and register our fake queue for testing.
    (QueueManager as any).queues = new Map();
    (QueueManager as any).queues.set("testQueue", fakeQueue as Queue);
  });

  it("should call queue.add with the correct delay", async () => {
    const jobData: NotificationJobData = {
      userIds: ["user1", "user2"],
      channel: "telegram",
      meta: [{ text: "hello" }, { text: "world" }],
      trackResponses: true,
      trackingKey: "notifications:stats",
      delay: 60000, // 60 seconds delay
    };

    await QueueManager.enqueueJob("testQueue", "testJob", jobData);

    expect(fakeQueueAdd).toHaveBeenCalledWith("testJob", jobData, {
      delay: 60000,
      removeOnComplete: true,
      removeOnFail: false,
    });
  });
});
