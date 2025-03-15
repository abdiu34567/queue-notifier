import Redis from "ioredis";
import { dispatchNotifications } from "../src/index";
import serviceAccount from "../firebase-service-account.json";

// Initialize Redis externally
const redis = new Redis("redis://localhost:6379");

async function runTest() {
  await dispatchNotifications({
    redisInstance: redis, // Use existing Redis instance
    notifierType: "firebase",
    notifierOptions: { serviceAccount }, // Firebase credentials
    dbQuery: async (offset, limit) => {
      // Simulating fetching Firebase user tokens from a database
      const users = [
        {
          userId:
            "clMaRRkiQN-UrkqReCpxBG:APA91bEhDzif-ahIseIPJBfqhxyWfO9GbjzBZoS3efeVQHGvJszixPznjunjNUvgjj5wFCtwF1_SBqJVheuUWVAv1lOEiyWCOMGJZT5fgciGQdq1-UmiTtg",
        },
        {
          userId:
            "e07wgUgFQMSMAROR5ohhX4:APA91bFe5gmF0qGy-Y7bM7r_8a66M0vJvsLyIjguDGtryKtkNniA_dOte5IF61y9uPowswwjBrw0gE5APY2VJt8AFaYjU1ns-NY94FUEj08vE68GwuoYQ8UpwPVl1Y2HWa9w0r5FyV2o",
        },
      ];
      return offset >= users.length ? [] : users.slice(offset, offset + limit);
    },
    mapRecordToUserId: (record) => record.userId,
    meta: () => ({ body: "FB bo..", title: "title" }),
    queueName: "notifications",
    jobName: "firebaseNotification",
    batchSize: 2, // Match test data size
    maxQueriesPerSecond: 5,
    startWorker: true, // Start worker automatically
    trackResponses: true,
  });
}

runTest().catch(console.error);
