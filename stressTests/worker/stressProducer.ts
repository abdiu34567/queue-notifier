import Redis from "ioredis";
import { NotificationChannel } from "../../src/jobs/channels/NotificationChannel";
import { RedisClient } from "../../src/utils/RedisClient";
import { dispatchNotifications } from "../../src";

const redis = new Redis("redis://localhost:6379");

// Test Configurations
const totalRecords = 1_000_000; // or 1_000_000_000 for extreme scale
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

const mapRecordToUserId = (record: { userId: string }) => record.userId;

(async () => {
  console.time("🕒 Producer Duration");

  // 1️⃣ Connect Redis & Set in SDK
  await new Promise<void>((resolve) => {
    redis.on("connect", () => {
      RedisClient.setInstance(redis);
      console.log("🚀 Redis connected (Producer).");
      resolve();
    });
  });

  // 2️⃣ Dispatch (Enqueue) Notifications
  await dispatchNotifications({
    redisInstance: redis,
    notifierType: "email", // Any channel is fine; we'll override with a custom notifier
    customNotifier: new DummyNotifier(), // ✅ Override the actual notifier
    notifierOptions: {}, // No actual config needed since we use a dummy
    dbQuery: mockDbQuery,
    mapRecordToUserId,
    meta: (user) => ({
      text: "Mass Notification Test 🚀" + user.userId.split("_")[1],
      subject: "System-Wide Announcement",
    }),
    queueName: "stressTestQueue",
    jobName: "dummyNotification",
    batchSize,
    maxQueriesPerSecond,
    // IMPORTANT: We do NOT automatically start the worker here.
    // startWorker: false,
    trackResponses: true,
    trackingKey: "stressTest:stats",
    loggingEnabled: false,
  });

  // 3️⃣ Wait for enqueuing to finish
  console.timeEnd("🕒 Producer Duration");
  console.log("✅ Producer has enqueued all jobs!");
  process.exit(0);
})();
