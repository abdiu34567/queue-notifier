import Redis from "ioredis";
import { startWorkerServer } from "../../src/utils/StartWorkerServer";
import { getNotificationStats } from "../../src/utils/ResponseTrackers";

const redis = new Redis("redis://localhost:6379");

// Optionally prefix for different environments
const queueName = "notifications";
// const queueName = "stressTestQueue";

(async () => {
  await new Promise<void>((resolve) => {
    redis.on("connect", () => {
      console.log("🚀 Redis connected (Worker).");
      resolve();
    });
  });

  startWorkerServer({
    redisInstance: redis,
    queueName,
    concurrency: 20,
    notifiers: {
      telegram: {
        botToken: "7530649******uGnlslcaAH8",
      },
    },
    // Called whenever a job completes
    onComplete: async (job, stats) => {
      console.log(`🔔 Job ${job.id} completed. Stats so far:`, stats);
    },
    // Called when queue is truly empty
    onDrained: async () => {
      // Retrieve final stats
      const finalStats = await getNotificationStats("stressTest:stats");
      console.log("📊 Final Notification Stats:", finalStats);
      console.log("✅ Worker done processing all jobs. Shutting down...");
    },
  });
})();
