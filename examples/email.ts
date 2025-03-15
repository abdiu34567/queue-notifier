import Redis from "ioredis";
import { dispatchNotifications } from "../src/index.ts";

// Initialize Redis externally
const redis = new Redis("redis://localhost:6379");

async function runTest() {
  await dispatchNotifications({
    redisInstance: redis, // Pass the Redis instance
    notifierType: "email",
    notifierOptions: {
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: "my-email@gmail.com",
        pass: "my-email-pass",
      },
      from: "me@gmail.com",
    },
    dbQuery: async (offset, limit) => {
      // Simulating fetching email addresses from a database
      const users = [
        { email: "email1@gmail.com" },
        { email: "email2@host.com" },
      ];
      return offset >= users.length ? [] : users.slice(offset, offset + limit);
    },
    mapRecordToUserId: (record) => record.email,
    meta: (user) => ({
      text: "Manual Test: Email Notifier ✅",
      subject: "My Subject",
    }),
    queueName: "notifications",
    jobName: "emailNotification",
    batchSize: 2,
    maxQueriesPerSecond: 5,
    startWorker: true,
    trackResponses: true,
  });
}

runTest().catch(console.error);
