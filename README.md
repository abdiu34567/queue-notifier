# Notify Worker SDK

## 🚀 Overview

**Notify Worker SDK** is a scalable, high-performance job queueing system designed for handling large-scale **notifications** across multiple channels, including:

- **Email** (SMTP-based)
- **Firebase Push Notifications** (FCM)
- **Telegram Messages**
- **Web Push Notifications**

This SDK efficiently **queues and processes notifications** while supporting **rate-limiting, response tracking, and error handling**. It integrates seamlessly with **Redis** using `bullmq` for distributed job management.

---

## 📦 Installation

```sh
npm install notify-worker-sdk
```

---

## 🔧 Configuration Options

### **`dispatchNotifications` Options**

| Option                | Type                                              | Default Value           | Description                                |
| --------------------- | ------------------------------------------------- | ----------------------- | ------------------------------------------ | ------ | ------------ | ---------------------------------- |
| `redisInstance`       | `Redis`                                           | **Required**            | External Redis instance for job queueing   |
| `notifierType`        | `'firebase'                                       | 'telegram'              | 'email'                                    | 'web'` | **Required** | Specifies the notification channel |
| `notifierOptions`     | `object`                                          | **Required**            | Configuration for the chosen notifier      |
| `dbQuery`             | `(offset: number, limit: number) => Promise<T[]>` | **Required**            | Function to fetch users in batches         |
| `mapRecordToUserId`   | `(record: T) => string`                           | **Required**            | Extracts user identifiers from DB records  |
| `message`             | `string`                                          | **Required**            | Message content for the notification       |
| `meta`                | `object`                                          | `{}`                    | Extra metadata (e.g., title, HTML content) |
| `queueName`           | `string`                                          | `'notifications'`       | The queue name for job processing          |
| `jobName`             | `string`                                          | `'notificationJob'`     | The job name inside the queue              |
| `batchSize`           | `number`                                          | `1000`                  | Number of users processed per batch        |
| `maxQueriesPerSecond` | `number`                                          | `10`                    | Limits database query rate                 |
| `startWorker`         | `boolean`                                         | `false`                 | Whether to start a worker automatically    |
| `trackResponses`      | `boolean`                                         | `false`                 | Enables response/error tracking in Redis   |
| `trackingKey`         | `string`                                          | `'notifications:stats'` | Redis key for storing response statistics  |
| `loggingEnabled`      | `boolean`                                         | `true`                  | Enables or disables logging                |

---

## 📚 Usage Examples

### **1️⃣ Email Notifications**

```typescript
import Redis from "ioredis";
import { dispatchNotifications } from "notify-worker-sdk";

const redis = new Redis("redis://localhost:6379");

await dispatchNotifications({
  redisInstance: redis,
  notifierType: "email",
  notifierOptions: {
    host: "smtp.example.com",
    port: 465,
    secure: true,
    auth: { user: "user@example.com", pass: "password" },
    from: "notifications@example.com",
  },
  dbQuery: async (offset, limit) => [{ userId: "test@example.com" }],
  mapRecordToUserId: (record) => record.userId,
  message: "Test Email Notification",
  meta: { subject: "Hello!" },
  queueName: "notifications",
  jobName: "emailNotification",
  startWorker: true,
});
```

### **2️⃣ Firebase Push Notifications (FCM)**

```typescript
await dispatchNotifications({
  redisInstance: redis,
  notifierType: "firebase",
  notifierOptions: {
    serviceAccount: require("./firebase-service-account.json"),
  },
  dbQuery: async (offset, limit) => [{ userId: "firebase-token-123" }],
  mapRecordToUserId: (record) => record.userId,
  message: "Test Push Notification!",
  meta: { title: "New Alert!" },
  queueName: "notifications",
  jobName: "firebaseNotification",
  trackResponses: true,
  trackingKey: "notifications:firebaseStats",
});
```

### **3️⃣ Telegram Messages**

```typescript
await dispatchNotifications({
  redisInstance: redis,
  notifierType: "telegram",
  notifierOptions: { botToken: "123456:ABC-DEF" },
  dbQuery: async (offset, limit) => [{ userId: "1173180004" }],
  mapRecordToUserId: (record) => record.userId,
  message: "Test Telegram Notification!",
  queueName: "notifications",
  jobName: "telegramNotification",
});
```

### **4️⃣ Web Push Notifications**

```typescript
await dispatchNotifications({
  redisInstance: redis,
  notifierType: "web",
  notifierOptions: {
    publicKey: "YOUR_VAPID_PUBLIC_KEY",
    privateKey: "YOUR_VAPID_PRIVATE_KEY",
    contactEmail: "admin@example.com",
  },
  dbQuery: async (offset, limit) => [
    { userId: JSON.stringify(subscriptionData) },
  ],
  mapRecordToUserId: (record) => record.userId,
  message: "Web Push Test!",
  meta: { title: "Web Alert!" },
  queueName: "notifications",
  jobName: "webPushNotification",
});
```

---

## 📊 Response Tracking in Redis

If `trackResponses` is enabled, **response stats are stored in Redis**:

```bash
redis-cli
HGETALL notifications:stats
```

**Example Output:**

```json
{
  "success": "950000",
  "Invalid email address": "3000",
  "User blocked the bot": "2000"
}
```

---

## 🛠 Debugging & Logs

By default, logs are **enabled**. You can disable logs:

```typescript
await dispatchNotifications({ loggingEnabled: false });
```

---

## 🚀 Contributing

Feel free to open an **issue** or submit a **pull request**!

---

## 📜 License

MIT License © 2025 Notify Worker SDK
