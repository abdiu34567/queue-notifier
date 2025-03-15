import Redis from "ioredis";
import { dispatchNotifications } from "../src/index";

// Initialize Redis externally
const redis = new Redis("redis://localhost:6379");

async function runTest() {
  await dispatchNotifications({
    redisInstance: redis, // Use existing Redis instance
    notifierType: "telegram",
    notifierOptions: {
      botToken: "<your-bot-token>",
    },
    dbQuery: async (offset, limit) => {
      // Simulating fetching Telegram user IDs from a database
      const users = [
        { userId: "1173180004", lang: "eng" },
        { userId: "1263669270", lang: "am" },
      ];
      return offset >= users.length ? [] : users.slice(offset, offset + limit);
    },
    mapRecordToUserId: (record) => record.userId,
    meta: (user) => ({ text: "<b>hello there</b>", parse_mode: "HTML" }),
    queueName: "notifications",
    jobName: "telegramNotification",
    batchSize: 2, // Match test data size
    maxQueriesPerSecond: 5,
    startWorker: true, // Start worker automatically
    trackResponses: true,
    loggingEnabled: true,
  });
}

runTest().catch(console.error);
