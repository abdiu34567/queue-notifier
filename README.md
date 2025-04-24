# Queue Notifier SDK

**Queue Notifier SDK** is a TypeScript library designed for efficiently dispatching large volumes of notifications through multiple channels—Firebase (FCM), Telegram, Email, and Web Push—using reliable Redis-backed job queues powered by `BullMQ`. It simplifies batch processing of recipients queried from a database, includes rate limiting, supports campaign cancellation, and features configurable structured logging.

---

## Features

- **Multi-channel Notifications:** Send via Firebase (FCM), Telegram Bot, Email (SMTP), and Web Push.
- **Robust Job Queueing:** Leverages Redis and `BullMQ` for persistent, scalable background job processing.
- **Batch Database Processing:** Efficiently fetches recipients from your database in batches using a provided query function.
- **Rate Limiting:** Built-in rate limiting for database queries and individual notifier channels.
- **Structured Logging:** Uses `pino` for fast, JSON-based logging with configurable levels (`info`, `debug`, `trace`, etc.).
- **Response Tracking:** (Optional) Aggregates success/error counts per channel in Redis hashes.
- **Campaign Cancellation:** (Optional) Allows cancelling in-progress notification dispatches via Redis flags based on a `campaignId`.
- **Clear Separation:** Distinct functions for dispatching jobs and running worker processes.

---

## Architecture

The SDK promotes a standard producer-consumer pattern:

1.  **Dispatcher (`dispatchNotifications`):** Your application code calls this function. It queries your database in batches, formats job data (including recipients and metadata), and enqueues these jobs into a BullMQ queue in Redis.
2.  **Redis (BullMQ):** Acts as the persistent message broker holding the notification jobs.
3.  **Worker (`startWorkerServer`):** A separate, long-running process (or multiple processes) that connects to Redis, listens to the queue, dequeues jobs, and uses the appropriate notifier (Email, Firebase, etc.) to send the notifications specified in the job data.

```
+--------------------------+      +----------------+      +--------------------------+
| Your Application         | ---> | Redis (BullMQ) | <--- | Worker Process(es)       |
| (Calls                   |      | (Job Queue)    |      | (Runs startWorkerServer) |
|  dispatchNotifications)  |      +----------------+      |  - Processes Jobs        |
+--------------------------+                              |  - Sends Notifications   |
                                                          +--------------------------+
```

---

## Installation

Install the SDK using npm or yarn. Required dependencies (`ioredis`, `bullmq`, `pino`) will be installed automatically.

```bash
# Using npm
npm install queue-notifier

# Using yarn
yarn add queue-notifier
```

---

## Core Concepts

### 1. Dispatching Notifications (`dispatchNotifications`)

This function is called from your main application logic to initiate the notification process.

**Configuration (`DispatchNotificationOptions<T, N>`):**

- **`redisConnection: Redis | RedisOptions`**: _Required._ Your `ioredis` instance or connection options. If options are provided, ensure `maxRetriesPerRequest: null` is set for BullMQ compatibility (the SDK handles this if it creates the instance).
- **`channelName: N`**: _Required._ The name of the target channel (e.g., `"firebase"`, `"email"`, `"telegram"`, `"web"`). Must match a notifier configured in your worker. `N` is a generic type constrained to keys of `NotificationMeta`.
- **`dbQuery: (offset: number, limit: number) => Promise<T[]>`**: _Required._ Function to query your database for recipient records, supporting pagination (`offset`, `limit`). Returns an empty array when no more records are found. `T` is the generic type of your database record.
- **`mapRecordToUserId: (record: T) => string`**: _Required._ Function to extract the unique recipient identifier (FCM token, email address, chat ID, stringified PushSubscription) from a database record (`T`).
- **`meta: (user: T) => RequiredMeta[N]`**: _Required._ Function to generate the notification metadata _specific to the `channelName`_ for a given user record (`T`). The return type `RequiredMeta[N]` ensures type safety based on the channel. See `NotificationMeta` details below.
- **`queueName: string`**: _Required._ Name of the BullMQ queue to add jobs to (e.g., `"notifications"`).
- **`jobName: string`**: _Required._ Name for the jobs added to the queue (e.g., `"send-promo-email"`). Used for worker processing and monitoring.
- **`campaignId?: string`**: _Optional._ A unique identifier for this specific dispatch operation (e.g., `"summer-sale-2024"`). If provided, you can use this ID to request cancellation of processing for this campaign via Redis (see Cancellation section).
- **`batchSize?: number`**: Number of database records to fetch per `dbQuery` call. Default: `1000`.
- **`maxQueriesPerSecond?: number`**: Rate limit for calling `dbQuery`. Uses a token bucket limiter. Default: No limit.
- **`trackResponses?: boolean`**: Whether workers should track success/error counts in Redis. Default: `false`.
- **`trackingKey?: string`**: Base Redis key for storing response counts if `trackResponses` is true. Default: `"notifications:stats"`. Job data can override this.
- **`jobOptions?: JobsOptions`**: _Optional._ Pass BullMQ `JobsOptions` directly to customize job behavior (e.g., `{ attempts: 3, backoff: { type: 'exponential', delay: 1000 } }`, `{ delay: 60000 }`). See BullMQ documentation.
- **`enqueueRetries?: number`**: Max retries for the _enqueue operation itself_ if Redis is temporarily unavailable during dispatch. Default: `3`.
- **`enqueueBaseDelay?: number`**: Initial delay (ms) for enqueue retries. Default: `200`.

**Example Dispatch Call:**

```typescript
import Redis from "ioredis";
import { dispatchNotifications, NotificationMeta } from "queue-notifier";

// Define your DB record type
interface UserRecord {
  id: number;
  fcmToken: string;
  name: string;
}
// Define your specific meta type (matches NotificationMeta['firebase'])
type MyFirebaseMeta = NotificationMeta["firebase"];

const redis = new Redis({
  /* ... your options, MUST include maxRetriesPerRequest: null ... */
});

async function sendFcmPromo() {
  const campaignId = `fcm-promo-${Date.now()}`;
  console.log(`Dispatching campaign: ${campaignId}`);

  await dispatchNotifications<UserRecord, "firebase">({
    redisConnection: redis,
    channelName: "firebase", // Target channel
    dbQuery: async (offset, limit): Promise<UserRecord[]> => {
      console.log(`DB Query: offset=${offset}, limit=${limit}`);
      // Replace with your actual database query logic
      // Example: return await db.select('*').from('users').where('active', true).limit(limit).offset(offset);
      const users: UserRecord[] = [
        { id: 1, fcmToken: "token_1...", name: "Alice" },
        { id: 2, fcmToken: "token_2...", name: "Bob" },
      ]; // Sample
      return offset >= users.length ? [] : users.slice(offset, offset + limit);
    },
    mapRecordToUserId: (record) => record.fcmToken, // Extract FCM token
    meta: (user): MyFirebaseMeta => ({
      // Return FirebaseMeta structure
      title: `Hello ${user.name}!`,
      body: "Check out our new promo!",
      data: { userId: String(user.id), source: "promo-dispatch" },
    }),
    queueName: "fcm-notifications",
    jobName: "send-fcm-promo", // Job type identifier
    campaignId: campaignId, // For potential cancellation
    batchSize: 500,
    maxQueriesPerSecond: 10,
    trackResponses: true,
    jobOptions: { attempts: 2 }, // Example: Limit job processing attempts
  });

  console.log(`Campaign ${campaignId} dispatched.`);
  // await redis.quit(); // Close connection if appropriate for your app
}

sendFcmPromo().catch(console.error);
```

### 2. Running the Worker (`startWorkerServer`)

This function starts a long-running process that listens to a queue and processes jobs dispatched by `dispatchNotifications`. It should typically be run in a separate process/container.

**Configuration (`WorkerConfig`):**

- **`redisConnection: Redis | RedisOptions`**: _Required._ Connection to the same Redis used by the dispatcher. Must have `maxRetriesPerRequest: null`.
- **`queueName: string`**: _Required._ The name of the queue to listen to (must match `queueName` used in `dispatchNotifications`).
- **`notifiers: { ... }`**: _Required (at least one)._ Configuration object for the notifiers this worker should handle. The keys must match the `channelName`(s) used during dispatch.
  - `telegram?: { botToken: string; maxMessagesPerSecond?: number; }`
  - `email?: { host: string; port: number; secure: boolean; auth: { user: string; pass: string }; from: string; maxEmailsPerSecond?: number; }`
  - `firebase?: ServiceAccount | string; maxMessagesPerSecond?: number;` (Pass Service Account object or path string)
  - `web?: { publicKey: string; privateKey: string; contactEmail: string; maxMessagesPerSecond?: number; }`
  - _(You can add custom notifiers by registering them manually with `NotifierRegistry` before/after starting the worker)_
- **`concurrency?: number`**: Number of jobs this worker processes in parallel. Default: `10`.
- **`trackingKey?: string`**: Default base Redis key for tracking stats if a job's data doesn't specify one. Default: `"notifications:stats"`.
- **`resetStatsAfterCompletion?: boolean`**: If `true`, resets the stats hash associated with a job's `trackingKey` after the job completes successfully _and_ after the `onComplete` callback runs. Default: `false`.
- **`onStart?: (job: Job, logger: PinoLogger) => Promise<void> | void`**: Optional async callback executed when a job begins processing. Receives the BullMQ `Job` object and a job-specific logger instance.
- **`onComplete?: (job: Job, stats: Record<string, string>, logger: PinoLogger) => Promise<void> | void`**: Optional async callback executed after a job successfully completes _and_ stats (if tracked) are retrieved. Receives the `Job`, the fetched stats object, and a job-specific logger.
- **`onDrained?: (logger: PinoLogger) => Promise<void> | void`**: Optional async callback executed when the queue becomes empty after having active jobs. Receives the base worker logger.
- **`bullWorkerOptions?: Partial<BullMQWorkerOptions>`**: _Optional._ Pass advanced options directly to the underlying BullMQ `Worker` constructor (e.g., `{ lockDuration: 60000 }`). See BullMQ documentation.

**Example Worker Script (`worker.ts`):**

```typescript
import Redis from "ioredis";
import { startWorkerServer } from "queue-notifier";
import { PinoLogger } from "pino"; // Import type for callbacks
import { Job } from "bullmq";
import path from "path";

console.log("Starting Notification Worker...");

const redis = new Redis({
  host: "localhost",
  port: 6379,
  maxRetriesPerRequest: null, // REQUIRED for BullMQ
  enableReadyCheck: false, // Recommended for BullMQ
});

redis.on("error", (err) => console.error("Worker Redis Error:", err));

// Ensure firebase credentials path is correct
// const serviceAccountPath = path.join(__dirname, './firebase-service-account.json');
// const serviceAccount = require(serviceAccountPath);
// OR directly import if using ESM/TS config setup
import serviceAccount from "./firebase-service-account.json";

const workerManager = startWorkerServer({
  redisConnection: redis,
  queueName: "fcm-notifications", // Listen to the correct queue
  concurrency: 15,
  notifiers: {
    // Only configure notifiers this worker should handle
    firebase: serviceAccount, // Provide credentials
    // email: { /* ... email config ... */ },
  },
  trackingKey: "fcm:stats", // Default tracking key for this worker
  resetStatsAfterCompletion: false,

  onStart: async (job: Job, logger: PinoLogger) => {
    logger.info(`Processing started for campaign ${job.data.campaignId}`);
  },

  onComplete: async (
    job: Job,
    stats: Record<string, string>,
    logger: PinoLogger
  ) => {
    logger.info(
      { stats },
      `Processing complete for campaign ${job.data.campaignId}`
    );
    // Maybe send a webhook, update database, etc.
  },

  onDrained: async (logger: PinoLogger) => {
    logger.info("Queue is drained. Worker idle.");
    // Optional: Maybe exit if running as a one-off task?
    // process.exit(0);
  },
});

console.log(`Worker listening on queue: "fcm-notifications"`);

// --- Graceful Shutdown ---
const gracefulShutdown = async (signal: string) => {
  console.log(`Received ${signal}. Shutting down worker gracefully...`);
  try {
    await workerManager.close();
    console.log("WorkerManager closed.");
    // Close Redis connection if appropriate for this process
    if (redis.status === "ready") {
      await redis.quit();
      console.log("Redis connection closed.");
    }
  } catch (err) {
    console.error("Error during shutdown:", err);
    process.exit(1);
  }
  process.exit(0);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT")); // Handle Ctrl+C
```

### 3. Metadata (`NotificationMeta`)

When calling `dispatchNotifications`, the `meta` function must return an object matching the structure expected by the target `channelName`. The SDK uses TypeScript generics and the `NotificationMeta` interface (defined in `NotificationChannel.ts`) to help enforce this.

```typescript
// Defined within the SDK (src/jobs/channels/NotificationChannel.ts)
export interface EmailMeta {
  subject: string;
  text?: string;
  html?: string /* ... */;
}
export interface FirebaseMeta {
  title?: string;
  body?: string;
  data?: { [key: string]: string } /* ... */;
}
export interface TelegramMeta {
  text: string;
  parse_mode?: "HTML" | "MarkdownV2" /* ... */;
}
export interface WebPushMeta {
  title: string;
  body: string /* ... */;
}

export interface NotificationMeta {
  email: EmailMeta;
  firebase: FirebaseMeta;
  telegram: TelegramMeta;
  web: WebPushMeta;
}
```

Your `meta: (user) => ({ ... })` function should return the correct corresponding type (e.g., `FirebaseMeta` if `channelName` is `'firebase'`).

---

## Advanced Features

### Campaign Cancellation

You can stop workers from processing jobs belonging to a specific campaign _after_ they have been dispatched.

1.  **Dispatch with `campaignId`:** When calling `dispatchNotifications`, provide a unique `campaignId` string.
    ```typescript
    dispatchNotifications({
      // ...
      campaignId: "promo-xyz-123",
      // ...
    });
    ```
2.  **Set Redis Flag:** To cancel processing for this campaign, use any Redis client to set a specific key. The key format is `worker:cancel:campaign:<campaignId>`.
    ```typescript
    // Example using ioredis client elsewhere
    const redis = new Redis(/* ... */);
    const campaignToCancel = "promo-xyz-123";
    await redis.set(
      `worker:cancel:campaign:${campaignToCancel}`,
      "true",
      "EX",
      3600
    ); // Set flag to 'true', optionally expire after 1 hour
    await redis.quit();
    ```
3.  **Worker Behavior:** Workers checking the queue will see this flag _before_ processing a job with that `campaignId` and will skip processing it (marking the job as complete without sending notifications).
4.  **Clear Flag:** Remember to `DEL` the Redis key when you want jobs for that campaign to resume processing normally.

### Response Tracking Utilities

If `trackResponses` is enabled, use these functions (typically outside the SDK core flow, e.g., in monitoring scripts or admin panels) to view or manage stats. They require a Redis instance and the logger.

```typescript
import Redis from "ioredis";
import { getNotificationStats, resetNotificationStats } from "queue-notifier";
import { loggerFactory } from "queue-notifier"; // Assuming factory is exported

const redis = new Redis({ maxRetriesPerRequest: null }); // Use compatible instance
const logger = loggerFactory.createLogger({ component: "StatsUtil" });
const myTrackingKey = "fcm:stats"; // Or the default 'notifications:stats'

async function checkStats() {
  const stats = await getNotificationStats(redis, myTrackingKey, logger);
  console.log(`Stats for ${myTrackingKey}:`, stats);
  // Output example: { success: '1500', 'error:messaging/invalid-registration-token': '25', 'error:TIMEOUT': '3' }

  // Optional: Reset stats
  // await resetNotificationStats(redis, myTrackingKey, logger);
  // console.log(`Stats reset for ${myTrackingKey}`);

  await redis.quit();
}

checkStats();
```

---

## 🪵 Logging

The SDK uses [`pino`](https://getpino.io/) for efficient, structured JSON logging.

**Log Output:**

- **Production (`NODE_ENV=production`):** Logs are output as standard JSON lines, suitable for log collection systems (Datadog, Splunk, ELK, etc.).
  ```json
  {
    "level": "info",
    "time": "2023-10-27T10:00:00.123Z",
    "pid": 123,
    "hostname": "server-1",
    "component": "WorkerManager",
    "queue": "my-queue",
    "msg": "Worker listening."
  }
  ```
- **Development (Other `NODE_ENV` or unset):**
  - **If `pino-pretty` is detected:** If you have installed `pino-pretty` as a dev dependency in your project (`npm i --save-dev pino-pretty` or `yarn add --dev pino-pretty`), the SDK will automatically detect it and format logs for better readability in your console during development.
    ```
    [2023-10-27 10:00:00.123 INFO] (WorkerManager on my-queue): Worker listening.
    ```
  - **If `pino-pretty` is NOT detected:** The SDK will output standard JSON logs and print a warning suggesting you install `pino-pretty` for a better development experience. You can still manually pipe the JSON output:
    ```bash
    node your-worker-script.js | pino-pretty
    ```

**Configuration:**

- **Log Level:** Control the logging verbosity using the `LOG_LEVEL` environment variable. Supported levels: `fatal`, `error`, `warn`, `info` (default), `debug`, `trace`.

  ```bash
  # Example: Set level to debug
  LOG_LEVEL=debug node your-worker-script.js
  ```

  You can also set the level programmatically (affects all loggers created by the factory _after_ the call):

  ```typescript
  import { loggerFactory } from "queue-notifier";

  loggerFactory.setLevel("debug"); // Set level for subsequent operations
  ```

- **Log Context:** Logs automatically include contextual information like `component` (e.g., `WorkerManager`, `EmailNotifier`), `queue`, `jobId`, `campaignId`, etc., where available.

---

## License

MIT License © 2024

---

## Contributing

Contributions, issues, and feature requests are welcome.

---
