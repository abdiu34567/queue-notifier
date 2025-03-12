## **📢 Notify Worker SDK**

🚀 **Notify Worker SDK** is a powerful, flexible **job queue system** designed for handling notifications across multiple channels (**Telegram, Firebase, Email, Web Push**) with built-in **Redis-backed queue management**.

### **✨ Features**

- ✅ **Multi-channel support** (Telegram, Firebase, Email, Web Push)
- ✅ **Redis-powered queue management** (via **BullMQ**)
- ✅ **Rate-limiting** for controlled message dispatch
- ✅ **Batch processing** for large-scale notifications
- ✅ **Easy integration** with any database

---

## **📦 Installation**

```bash
npm install notify-worker-sdk
```

> Ensure **Redis** is installed and running.

---

## **🚀 Quick Start**

### **1️⃣ Initialize Redis**

```typescript
import Redis from "ioredis";
import { RedisClient } from "notify-worker-sdk";

// Create Redis instance and set globally
const redis = new Redis("redis://localhost:6379");
RedisClient.setInstance(redis);
```

---

### **2️⃣ Send Notifications in Batches**

#### **📌 Example: Firebase Notification**

```typescript
import {
  runBatchNotificationProcessor,
  RunBatchNotificationOptions,
} from "notify-worker-sdk";
import serviceAccount from "./firebase-service-account.json";

async function sendFirebaseNotifications() {
  const options: RunBatchNotificationOptions<{ userId: string }> = {
    redisInstance: redis,
    notifierType: "firebase",
    notifierOptions: { serviceAccount },
    dbQuery: async (offset, limit) => [
      { userId: "firebase-user-token-1" },
      { userId: "firebase-user-token-2" },
    ],
    mapRecordToUserId: (record) => record.userId,
    message: "🔥 Your Firebase Notification!",
    meta: { title: "Firebase Alert" },
    queueName: "notifications",
    jobName: "firebaseNotification",
    batchSize: 2,
    maxQueriesPerSecond: 5,
    startWorker: true,
  };

  await runBatchNotificationProcessor(options);
}

sendFirebaseNotifications();
```

---

#### **📌 Example: Telegram Notification**

```typescript
import {
  runBatchNotificationProcessor,
  RunBatchNotificationOptions,
} from "notify-worker-sdk";

async function sendTelegramNotifications() {
  const options: RunBatchNotificationOptions<{ userId: string }> = {
    redisInstance: redis,
    notifierType: "telegram",
    notifierOptions: { botToken: "YOUR_TELEGRAM_BOT_TOKEN" },
    dbQuery: async (offset, limit) => [
      { userId: "123456789" },
      { userId: "987654321" },
    ],
    mapRecordToUserId: (record) => record.userId,
    message: "📢 Telegram Notification Test!",
    queueName: "notifications",
    jobName: "telegramNotification",
    batchSize: 2,
    maxQueriesPerSecond: 5,
    startWorker: true,
  };

  await runBatchNotificationProcessor(options);
}

sendTelegramNotifications();
```

---

### **3️⃣ Web Push Notification**

```typescript
import {
  runBatchNotificationProcessor,
  RunBatchNotificationOptions,
} from "notify-worker-sdk";

async function sendWebPushNotifications() {
  const options: RunBatchNotificationOptions<{ subscription: string }> = {
    redisInstance: redis,
    notifierType: "web",
    notifierOptions: {
      publicKey: "YOUR_PUBLIC_KEY",
      privateKey: "YOUR_PRIVATE_KEY",
      contactEmail: "youremail@example.com",
    },
    dbQuery: async (offset, limit) => [
      {
        subscription: JSON.stringify({
          endpoint: "https://push-endpoint.com",
          keys: { p256dh: "...", auth: "..." },
        }),
      },
    ],
    mapRecordToUserId: (record) => record.subscription,
    message: "🌍 Web Push Test Notification!",
    meta: { title: "Web Push" },
    queueName: "notifications",
    jobName: "webPushNotification",
    batchSize: 1,
    maxQueriesPerSecond: 5,
    startWorker: true,
  };

  await runBatchNotificationProcessor(options);
}

sendWebPushNotifications();
```

---

## **💡 Advanced Usage**

### **Custom Rate-Limiting**

Modify **max queries per second** dynamically:

```typescript
batchSize: 500, // Process 500 users per batch
maxQueriesPerSecond: 10, // Ensure 10 requests per second
```

---

### **Worker Only Mode**

Want to enqueue jobs **separately** and process later?

```typescript
import { WorkerManager } from "notify-worker-sdk";

new WorkerManager({ queueName: "notifications" }); // Starts worker
```

---

## **📜 License**

MIT License © 2024 **Notify Worker SDK**

---

### **🚀 Ready to Scale Your Notifications?**

Start integrating today and **let Redis handle your notification workload effortlessly!** 🚀🔥
