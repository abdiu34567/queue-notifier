import Redis from "ioredis";
import { dispatchNotifications } from "../src/index";

// Initialize Redis externally
const redis = new Redis("redis://localhost:6379");

async function runTest() {
  await dispatchNotifications({
    redisInstance: redis, // Use existing Redis instance
    notifierType: "web",
    notifierOptions: {
      publicKey:
        "BFcRLUHyL9ng3ThJTKj1fV0YbMH0KfgPGx84lNMCmqI1A50aa2nvcT5N__fcGByfwsHRbwQJhzi_Nh_xvSTFtXE",
      privateKey: "zdLjzWzE3kI1w2gkX3a-vWITZYZA6eIuq1K9PB-R0KQ",
      contactEmail: "abdi****@gmail.com",
      maxMessagesPerSecond: 10,
    },
    dbQuery: async (offset, limit) => {
      // Simulating fetching Web Push subscriptions from a database
      const subscriptions = [
        {
          subscription: JSON.stringify({
            endpoint:
              "https://fcm.googleapis.com/fcm/send/cM9QdfS3b_U:APA91bFr-lxLRuxya6lTaHfs0LyQZFM0mMXYUKT6Ou3j7ys9InlDGlFRV3zZlYf0c6vfaLb7qdeRaa5SXqCp2cKY1v1bT19CVqqcU99EydKo5-UGNf7hMMV",
            expirationTime: null,
            keys: {
              p256dh:
                "BFoi1f16YiFs5AuetvEjpmY2E9g-YSFv_AFd3BmR6-D6ZKh9M3KMDsS9-MUz9JDy-Em4N6ImyRWU",
              auth: "Vy5N3xb-d676566y9p5ypZve_g",
            },
          }),
        },
      ];
      return offset >= subscriptions.length
        ? []
        : subscriptions.slice(offset, offset + limit);
    },
    mapRecordToUserId: (record) => record.subscription,
    meta: () => ({ title: "Web Push Test", body: "body" }),
    queueName: "notifications",
    jobName: "webPushNotification",
    batchSize: 1, // Only one subscription in test
    maxQueriesPerSecond: 5,
    startWorker: true, // Start worker automatically
    trackResponses: true,
  });
}

runTest().catch(console.error);
