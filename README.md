# Notify Worker SDK

**Notify Worker SDK** is a lightweight TypeScript library for dispatching notifications through multiple channels—`Firebase`, `Telegram Bot`, `Email`, and `Web Push`—using Redis-backed job queues (powered by `BullMQ`). It supports batch processing, rate limiting, response tracking, and configurable logging.

---

## Features

- **Multi-channel Support:**
  - Firebase, Telegram, Email, Web Push
- **Redis-Powered Queue Management:**
  - Leverages BullMQ for job processing
- **Batch Processing & Rate Limiting:**
  - Process large volumes of notifications efficiently
- **Response Tracking:**
  - Aggregates success and error responses in Redis
- **Configurable Logging:**
  - Enable or disable logging via the main configuration

---

## Installation

Install the SDK along with its required dependencies:

```bash
npm install notify-worker-sdk
```

> **Note:** Ensure you have a running Redis instance.

---

## Configuration Options

The SDK is configured using a single options object defined by the `DispatchNotificationOptions<T>` interface. Below are the available options with their defaults:

- **`redisInstance: Redis`**  
  _Required._ Externally initialized Redis instance.

- **`notifierType: "firebase" | "telegram" | "email" | "web"`**  
  _Required._ Specifies the notification channel.  
  **Default:** No default (must be specified).

- **`notifierOptions: any`**  
  _Required._ Options specific to the notifier.  
  Examples:

  - **Firebase:** `{ serviceAccount: { ... } }`
  - **Email:** `{ host: "smtp.example.com", port: 465, secure: true, auth: { user: "...", pass: "..." }, from: "..." }`
  - **Telegram:** `{ botToken: "123456:ABC-DEF" }`
  - **Web:** `{ publicKey: "...", privateKey: "...", contactEmail: "..." }`

- **`dbQuery: (offset: number, limit: number) => Promise<T[]>`**  
  _Required._ Function to query records (supports pagination).

- **`mapRecordToUserId: (record: T) => string`**  
  _Required._ Function to extract a unique user identifier (e.g., email, token, chat ID) from each record.

- **`message: string`**  
  _Required._ Notification content to be sent.

- **`meta?: Record<string, any>`**  
  Optional metadata (e.g., `subject` for emails, `title` for push notifications, `html` for emails).

- **`queueName: string`**  
  _Required._ Name of the queue (e.g., `"notifications"`).

- **`jobName: string`**  
  _Required._ Name of the job (e.g., `"emailNotification"`).

- **`batchSize?: number`**  
  Number of records processed per batch.  
  **Default:** Depends on the implementation (e.g., 1000 or user specified).

- **`maxQueriesPerSecond?: number`**  
  Rate limit for database queries.  
  **Default:** Depends on user setting (e.g., 5 or user specified).

- **`startWorker?: boolean`**  
  Whether to automatically start a worker to process jobs.  
  **Default:** `false`.

- **`trackResponses?: boolean`**  
  Whether to track API responses in Redis for analytics/debugging.  
  **Default:** `false`.

- **`trackingKey?: string`**  
  Redis key to store aggregated response counts.  
  **Default:** `"notifications:stats"`.

- **`loggingEnabled?: boolean`**  
  Controls logging throughout the SDK.  
  **Default:** `true`.

- **`customNotifier?: NotificationChannel`**  
  _(Optional)_ Allows using a custom notifier instance instead of the default implementation.

---

## Usage Examples

### **1. Firebase Notifications**

```typescript
import Redis from "ioredis";
import { dispatchNotifications } from "notify-worker-sdk";
import serviceAccount from "./firebase-service-account.json";

// Initialize Redis externally
const redis = new Redis("redis://localhost:6379");

await dispatchNotifications({
  redisInstance: redis,
  notifierType: "firebase",
  notifierOptions: { serviceAccount },
  dbQuery: async (offset, limit) => {
    // Example: Simulated database query returning Firebase tokens
    const users = [
      { userId: "firebase-token-1" },
      { userId: "firebase-token-2" },
    ];
    return offset >= users.length ? [] : users.slice(offset, offset + limit);
  },
  mapRecordToUserId: (record) => record.userId,
  meta: (user) => ({ title: "🔥 Firebase Alert" }),
  queueName: "notifications",
  jobName: "firebaseNotification",
  batchSize: 2,
  maxQueriesPerSecond: 5,
  startWorker: true,
  trackResponses: true,
  trackingKey: "notifications:stats",
  loggingEnabled: true,
});
```

---

### **2. Telegram Notifications**

```typescript
import Redis from "ioredis";
import { dispatchNotifications } from "notify-worker-sdk";

// Initialize Redis externally
const redis = new Redis("redis://localhost:6379");

await dispatchNotifications({
  redisInstance: redis,
  notifierType: "telegram",
  notifierOptions: { botToken: "YOUR_TELEGRAM_BOT_TOKEN" },
  dbQuery: async (offset, limit) => {
    // Example: Simulated database query returning Telegram chat IDs
    const users = [{ userId: "123456789" }, { userId: "987654321" }];
    return offset >= users.length ? [] : users.slice(offset, offset + limit);
  },
  mapRecordToUserId: (record) => record.userId,
  meta: (user) => ({ text: "📢 Telegram Notification Test!" }),
  queueName: "notifications",
  jobName: "telegramNotification",
  batchSize: 2,
  maxQueriesPerSecond: 5,
  startWorker: true,
  trackResponses: false,
  loggingEnabled: true,
});
```

---

### **3. Email Notifications**

```typescript
import Redis from "ioredis";
import { dispatchNotifications } from "notify-worker-sdk";

// Initialize Redis externally
const redis = new Redis("redis://localhost:6379");

await dispatchNotifications({
  redisInstance: redis,
  notifierType: "email",
  notifierOptions: {
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: "test@gmail.com", pass: "password" },
    from: "test@gmail.com",
  },
  dbQuery: async (offset, limit) => {
    // Example: Simulated database query returning email addresses
    const users = [
      { userId: "user1@example.com" },
      { userId: "user2@example.com" },
    ];
    return offset >= users.length ? [] : users.slice(offset, offset + limit);
  },
  mapRecordToUserId: (record) => record.userId,
  meta: () => ({ subject: "Test Email Notification" }),
  queueName: "notifications",
  jobName: "emailNotification",
  batchSize: 2,
  maxQueriesPerSecond: 5,
  startWorker: true,
  trackResponses: true,
  trackingKey: "notifications:stats",
  loggingEnabled: true,
});
```

---

### **4. Web Push Notifications**

```typescript
import Redis from "ioredis";
import { dispatchNotifications } from "notify-worker-sdk";

// Initialize Redis externally
const redis = new Redis("redis://localhost:6379");

await dispatchNotifications({
  redisInstance: redis,
  notifierType: "web",
  notifierOptions: {
    publicKey: "YOUR_PUBLIC_KEY",
    privateKey: "YOUR_PRIVATE_KEY",
    contactEmail: "admin@example.com",
    maxMessagesPerSecond: 50,
  },
  dbQuery: async (offset, limit) => {
    // Example: Simulated database query returning stringified subscriptions
    const subscriptions = [
      {
        subscription: JSON.stringify({
          endpoint: "https://example.com/endpoint1",
          keys: { p256dh: "key1", auth: "auth1" },
        }),
      },
    ];
    return offset >= subscriptions.length
      ? []
      : subscriptions.slice(offset, offset + limit);
  },
  mapRecordToUserId: (record) => record.subscription,
  meta: (user) => ({
    title: "🌍 Web Push Test Notification!";
  }),
  queueName: "notifications",
  jobName: "webPushNotification",
  batchSize: 1,
  maxQueriesPerSecond: 5,
  startWorker: true,
  trackResponses: true,
  trackingKey: "notifications:stats",
  loggingEnabled: true,
});
```

---

## Default Values Summary

- **`batchSize`**: User-defined (commonly 1000 or as needed).
- **`maxQueriesPerSecond`**: User-defined (e.g., 5).
- **`startWorker`**: Default is `false` (if not specified).
- **`trackResponses`**: Default is `false` (if not specified).
- **`trackingKey`**: Defaults to `"notifications:stats"` if not provided.
- **`loggingEnabled`**: Defaults to `true`.

---

## 🚀 Starting the Worker Independently (On a Separate Server)

In a distributed system, you may want to **dispatch notifications from one server** and **process them on a different server** (worker server).

The `notify-worker-sdk` allows you to **easily start the worker on a separate instance** to process jobs asynchronously.

### **🔧 Example: Starting the Worker Server**

To start the worker **on a separate instance**, use the `startWorkerServer` function:

```typescript
import Redis from "ioredis";
import { startWorkerServer } from "notify-worker-sdk";

// Initialize Redis externally
const redis = new Redis("redis://localhost:6379");

// Start the worker to process jobs from the queue
startWorkerServer({
  redisInstance: redis,
  queueName: "notifications",
  concurrency: 20, // Adjust based on your system resources
  notifiers: {
    telegram: { botToken: process.env.BOT_TOKEN as string },
    email: {
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: "your-email@gmail.com", pass: "your-password" },
      from: "your-email@gmail.com",
    },
    firebase: { serviceAccount: require("./firebase-service-account.json") },
    web: {
      publicKey: "YOUR_PUBLIC_KEY",
      privateKey: "YOUR_PRIVATE_KEY",
      contactEmail: "admin@example.com",
    },
  },
});

console.log("✅ Worker server started successfully!");
```

### **🛠️ Configuration Options**

| Option               | Type                                      | Required | Description                                        |
| -------------------- | ----------------------------------------- | -------- | -------------------------------------------------- |
| `redisInstance`      | `Redis`                                   | ✅       | External Redis instance used for job queueing      |
| `queueName`          | `string`                                  | ✅       | The queue name that the worker will listen to      |
| `concurrency`        | `number`                                  | ❌       | Number of jobs processed in parallel (default: 10) |
| `notifiers.telegram` | `{ botToken: string }`                    | ❌       | Config for Telegram notifications                  |
| `notifiers.email`    | `{ host, port, auth, from }`              | ❌       | Config for Email notifications                     |
| `notifiers.firebase` | `{ serviceAccount: object }`              | ❌       | Firebase push notification config                  |
| `notifiers.web`      | `{ publicKey, privateKey, contactEmail }` | ❌       | Web push notification config                       |

### **📌 Notes**

- The worker **must run on a separate server instance** for better scalability.
- Redis must be **shared across all instances** to synchronize job processing.
- You can **start multiple worker instances** to increase processing power.

---

## License

MIT License © 2024

---

## Contributing

Contributions, issues, and feature requests are welcome. Feel free to check the [issues page](https://github.com/abdiu34567/notify-worker-sdk/issues).

---
