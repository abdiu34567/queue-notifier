import Redis from "ioredis";
import { dispatchNotifications } from "../src";
import { NotificationChannel } from "../src/jobs/channels/NotificationChannel";
import { RedisClient } from "../src/utils/RedisClient";
import { Queue } from "bullmq";

// 🚀 Set up Redis
const redis = new Redis("redis://localhost:6379");

// Test Configurations
const totalRecords = 1_000_000; // Change to 1,000,000,000 (1B) for extreme tests
const batchSize = 10_000;
const maxQueriesPerSecond = 100;

// 🔥 Dummy Notifier simulating Telegram messages with a 10% failure rate
class DummyNotifier implements NotificationChannel {
  async send(
    userIds: string[],
    meta: Record<string, any>[]
  ): Promise<
    { status: string; recipient: string; response?: any; error?: string }[]
  > {
    return userIds.map((userId, index) => {
      if (Math.random() < 0.1) {
        // Simulate 10% failure
        return {
          status: "failed",
          recipient: userId,
          error: "Simulated Error: Network issue",
        };
      }
      return {
        status: "success",
        recipient: userId,
        response: `Simulated Telegram delivery: ${meta[index].text}`,
      };
    });
  }
}

// 🚀 Simulated Database Query (Fake User Data)
async function mockDbQuery(
  offset: number,
  limit: number
): Promise<{ userId: string }[]> {
  if (offset >= totalRecords) return [];
  return Array.from(
    { length: Math.min(limit, totalRecords - offset) },
    (_, i) => ({ userId: `telegram_user_${offset + i}` })
  );
}

// Maps fake DB records to user IDs
const mapRecordToUserId = (record: { userId: string }) => record.userId;

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

  // 2️⃣ Dispatch notifications with custom dummy notifier
  await dispatchNotifications({
    redisInstance: redis,
    notifierType: "telegram", // ✅ Using "telegram" channel
    customNotifier: new DummyNotifier(), // ✅ Override with dummy
    notifierOptions: {}, // Not needed for dummy
    dbQuery: mockDbQuery,
    mapRecordToUserId,
    // We'll send a single message for all recipients:
    // message: "Mass Telegram Notification Test 🚀",
    meta: (user) => ({
      text: "Mass Telegram Notification Test 🚀",
    }),
    queueName: "telegramStressTestQueue",
    jobName: "telegramDummyNotification",
    batchSize,
    maxQueriesPerSecond,
    startWorker: true,
    trackResponses: true,
    trackingKey: "telegramStressTest:stats",
    loggingEnabled: true, // Enable logging to see progress
  });

  // 3️⃣ Wait for all jobs to be processed
  const queue = new Queue("telegramStressTestQueue", { connection: redis });
  while (
    (await queue.getWaitingCount()) > 0 ||
    (await queue.getActiveCount()) > 0
  ) {
    console.log("⏳ Waiting for Telegram jobs to be processed...");
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds
  }

  console.timeEnd("🕒 Test Duration");
  console.log("✅ Telegram Stress Test Completed!");
})();
