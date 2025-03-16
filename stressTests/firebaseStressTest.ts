import Redis from "ioredis";
import { dispatchNotifications } from "../src";
import { NotificationChannel } from "../src/jobs/channels/NotificationChannel";
import { RedisClient } from "../src/utils/RedisClient";
import { Queue } from "bullmq";

// 🚀 Set up Redis
const redis = new Redis("redis://localhost:6379");

// Test Configurations
const totalRecords = 1_000_000; // Change to 1_000_000_000 (1B) for extreme tests
const batchSize = 10_000;
const maxQueriesPerSecond = 100;

// 🔥 Dummy Notifier simulating Firebase messages with a 10% failure rate
class DummyFirebaseNotifier implements NotificationChannel {
  async send(
    userIds: string[],
    meta: Record<string, any>[]
  ): Promise<
    { status: string; recipient: string; response?: any; error?: string }[]
  > {
    return userIds.map((userId, index) => {
      // Simulate random 10% failure rate
      if (Math.random() < 0.1) {
        return {
          status: "failed",
          recipient: userId,
          error: "Simulated Firebase Error: invalid registration token",
        };
      }
      // Otherwise, pretend successful push
      return {
        status: "success",
        recipient: userId,
        response: `Simulated Firebase delivery: ${meta[index].title}`,
      };
    });
  }
}

// 🚀 Simulated Database Query (Fake User Data)
async function mockDbQuery(
  offset: number,
  limit: number
): Promise<{ token: string }[]> {
  if (offset >= totalRecords) return [];
  return Array.from(
    { length: Math.min(limit, totalRecords - offset) },
    (_, i) => ({
      token: `firebase_token_${offset + i}`,
    })
  );
}

// Maps fake DB records to user IDs
const mapRecordToUserId = (record: { token: string }) => record.token;

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

  // 2️⃣ Dispatch notifications with a custom dummy notifier
  await dispatchNotifications({
    redisInstance: redis,
    notifierType: "firebase", // Indicate the firebase channel
    customNotifier: new DummyFirebaseNotifier(), // Override with dummy
    notifierOptions: {}, // Not needed for the dummy
    dbQuery: mockDbQuery,
    mapRecordToUserId,
    meta: (user) => ({
      title: "System-Wide Announcement",
    }),
    queueName: "firebaseStressTestQueue",
    jobName: "firebaseDummyNotification",
    batchSize,
    maxQueriesPerSecond,
    startWorker: true,
    trackResponses: true,
    trackingKey: "firebaseStressTest:stats",
    loggingEnabled: true, // Enable logging to see progress
  });

  // 3️⃣ Wait for all jobs to be processed
  const queue = new Queue("firebaseStressTestQueue", { connection: redis });
  while (
    (await queue.getWaitingCount()) > 0 ||
    (await queue.getActiveCount()) > 0
  ) {
    console.log("⏳ Waiting for Firebase jobs to be processed...");
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds
  }

  console.timeEnd("🕒 Test Duration");
  console.log("✅ Firebase Stress Test Completed!");
})();
