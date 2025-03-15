import Redis from "ioredis";
import { dispatchNotifications } from "../src";
import { NotificationChannel } from "../src/jobs/channels/NotificationChannel";
import RedisClient from "../src/utils/RedisClient";
import { Queue } from "bullmq";

// 🚀 Set up Redis
const redis = new Redis("redis://localhost:6379");

// Test Configurations
const totalRecords = 1_000_000; // Change to 1_000_000_000 (1B) for extreme tests
const batchSize = 10_000;
const maxQueriesPerSecond = 100;

// 🚀 Simulated Notifier (Does Not Actually Send Notifications)
class DummyNotifier implements NotificationChannel {
  async send(
    userIds: string[],
    meta: Record<string, any>[]
  ): Promise<
    { status: string; recipient: string; response?: any; error?: string }[]
  > {
    return userIds.map((userId, index) => {
      if (Math.random() < 0.1) {
        // 🔥 Simulate 10% failure rate
        return {
          status: "failed",
          recipient: userId,
          error: "Simulated Error: Network issue",
        };
      }
      return {
        status: "success",
        recipient: userId,
        response: `Simulated delivery: ${meta[index].text}`,
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
    (_, i) => ({
      userId: `user_${offset + i}`,
    })
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
      RedisClient.setInstance(redis); // ✅ Set Redis instance
      console.log("🚀 Redis connected.");
      resolve(null);
    });
  });

  // 2️⃣ Start processing after Redis is ready
  await dispatchNotifications({
    redisInstance: redis,
    notifierType: "email", // Still uses "email", but custom notifier overrides it
    customNotifier: new DummyNotifier(), // ✅ Override the actual notifier
    notifierOptions: {}, // Not needed when using a custom notifier
    dbQuery: mockDbQuery,
    mapRecordToUserId,
    meta: () => ({
      text: "Mass Notification Test 🚀",
      subject: "System-Wide Announcement",
    }),
    queueName: "stressTestQueue",
    jobName: "dummyNotification",
    batchSize,
    maxQueriesPerSecond,
    startWorker: true,
    trackResponses: true,
    trackingKey: "stressTest:stats",
    loggingEnabled: true,
  });

  // 3️⃣ Wait for all jobs to be processed
  const queue = new Queue("stressTestQueue", { connection: redis });
  while (
    (await queue.getWaitingCount()) > 0 ||
    (await queue.getActiveCount()) > 0
  ) {
    console.log("⏳ Waiting for jobs to be processed...");
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 sec
  }

  console.timeEnd("🕒 Test Duration");
  console.log("✅ Stress Test Completed!");
})();
