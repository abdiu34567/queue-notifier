import Redis from "ioredis";
import { dispatchNotifications } from "../src";
import { NotificationChannel } from "../src/jobs/channels/NotificationChannel";
import RedisClient from "../src/utils/RedisClient";
import { Queue } from "bullmq";

// 🚀 Set up Redis
const redis = new Redis("redis://localhost:6379");

// Test Configurations
const totalRecords = 1_000_000; // Change to 1,000,000,000 (1B) for extreme tests
const batchSize = 10_000;
const maxQueriesPerSecond = 100;

// 🔥 Dummy Notifier simulating Web Push messages with a 10% failure rate
class DummyWebPushNotifier implements NotificationChannel {
  async send(
    userIds: string[],
    meta: Record<string, any>[]
  ): Promise<
    { status: string; recipient: string; response?: any; error?: string }[]
  > {
    return userIds.map((subscription, index) => {
      // Simulate a random 10% failure
      if (Math.random() < 0.1) {
        return {
          status: "failed",
          recipient: subscription,
          error: "Simulated WebPush Error: invalid subscription",
        };
      }

      // Otherwise, pretend success
      return {
        status: "success",
        recipient: subscription,
        response: `Simulated Web Push delivery: ${meta[index].title}`,
      };
    });
  }
}

// 🚀 Simulated Database Query (Fake User Data)
async function mockDbQuery(
  offset: number,
  limit: number
): Promise<{ subscription: string }[]> {
  if (offset >= totalRecords) return [];
  return Array.from(
    { length: Math.min(limit, totalRecords - offset) },
    (_, i) => ({
      subscription: `webpush_subscription_${offset + i}`,
    })
  );
}

// Maps fake DB records to user IDs
const mapRecordToUserId = (record: { subscription: string }) =>
  record.subscription;

// 🚀 Start the Stress Test
(async () => {
  console.time("🕒 Test Duration");

  // 1️⃣ Ensure Redis is fully initialized before doing anything else
  await new Promise((resolve) => {
    redis.on("connect", () => {
      RedisClient.setInstance(redis);
      console.log("🚀 Redis connected.");
      resolve(null);
    });
  });

  // 2️⃣ Dispatch notifications with a dummy web push notifier
  await dispatchNotifications({
    redisInstance: redis,
    notifierType: "web", // Indicate the web push channel
    customNotifier: new DummyWebPushNotifier(), // Override with dummy
    notifierOptions: {}, // Not needed for the dummy
    dbQuery: mockDbQuery,
    mapRecordToUserId,
    meta: () => ({ title: "System-Wide Announcement" }),
    queueName: "webPushStressTestQueue",
    jobName: "webPushDummyNotification",
    batchSize,
    maxQueriesPerSecond,
    startWorker: true,
    trackResponses: true,
    trackingKey: "webPushStressTest:stats",
    loggingEnabled: true, // Enable logging to see progress
  });

  // 3️⃣ Wait for all jobs to be processed
  const queue = new Queue("webPushStressTestQueue", { connection: redis });
  while (
    (await queue.getWaitingCount()) > 0 ||
    (await queue.getActiveCount()) > 0
  ) {
    console.log("⏳ Waiting for Web Push jobs to be processed...");
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds
  }

  console.timeEnd("🕒 Test Duration");
  console.log("✅ Web Push Stress Test Completed!");
})();
