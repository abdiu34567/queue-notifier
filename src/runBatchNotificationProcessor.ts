import Redis from "ioredis";
import { RedisClient } from "./utils/RedisClient";
import { processInBatches, retryWithBackoff } from "./core/BatchProcessor";
import { QueueManager } from "./core/QueueManager";
import { WorkerManager } from "./core/WorkerManager";
import { FirebaseNotifier } from "./jobs/channels/FirebaseNotifier";
import { TelegramNotifier } from "./jobs/channels/TelegramNotifier";
import { EmailNotifier } from "./jobs/channels/EmailNotifier";
import { WebPushNotifier } from "./jobs/channels/WebPushNotifier";
import { NotifierRegistry } from "./core/NotifierRegistry";
import Logger from "./utils/Logger";
import {
  NotificationChannel,
  NotificationMeta,
  RequiredMeta,
} from "./jobs/channels/NotificationChannel";
import { TokenBucketRateLimiter } from "./core/RateLimiter";

/**
 * Configuration options for running batch notifications.
 *
 * This configuration defines how notifications should be processed, queued, and tracked.
 * It allows customization of notification channels, database queries, rate limits, logging, and response tracking.
 */
export interface DispatchNotificationOptions<
  T,
  N extends keyof NotificationMeta
> {
  /**
   * The Redis instance to be used for queueing and processing notifications.
   * This must be externally initialized and passed to ensure efficient connection reuse.
   */
  redisInstance: Redis;

  /**
   * The notification channel to be used for sending messages.
   * Available options: "firebase", "telegram", "email", "web".
   */
  //   notifierType: keyof NotificationMeta;
  notifierType: N;

  /**
   * Configuration options specific to the chosen notifier.
   * Example:
   *  - For Firebase: `{ serviceAccount: {...} }`
   *  - For Email: `{ host: "smtp.example.com", auth: { user: "...", pass: "..." } }`
   *  - For Telegram: `{ botToken: "123456:ABC-DEF" }`
   *  - For Web Push: `{ publicKey: "...", privateKey: "...", contactEmail: "admin@example.com" }`
   */
  notifierOptions: any;

  /**
   * A function to query the database for records that need notifications.
   * The function should return an array of records in paginated form.
   *
   * @param offset - The starting index for fetching records.
   * @param limit - The maximum number of records to fetch per query.
   * @returns A promise that resolves to an array of records.
   */
  dbQuery: (offset: number, limit: number) => Promise<T[]>;

  /**
   * A function that extracts the unique user identifier from a database record.
   * This identifier will be used as the recipient ID in notifications.
   *
   * @param record - A single database record from the `dbQuery` result.
   * @returns A string representing the user ID (e.g., email, push token, chat ID).
   */
  mapRecordToUserId: (record: T) => string;

  /**
   * Metadata to be included with the message.
   * This can be used to pass additional data such as:
   *  - `title`: Used for push notifications or emails.
   *  - `html`: If sending an HTML email.
   *  - `data`: Custom data payload for Firebase/Web Push.
   */
  meta: (user: T) => RequiredMeta[N];

  /**
   * The name of the queue where notification jobs will be added.
   * Example: `"notifications"`
   */
  queueName: string;

  /**
   * The specific job name that will be processed within the queue.
   * Example: `"emailNotification"`
   */
  jobName: string;

  /**
   * The number of records to process in each batch.
   * Example: `batchSize: 100` → Process 100 records per cycle.
   * Default: `undefined` (uses a system-defined value).
   */
  batchSize?: number;

  /**
   * The maximum number of database queries per second.
   * This is useful for rate-limiting to prevent overloading the database.
   * Example: `maxQueriesPerSecond: 5` → Limit to 5 queries per second.
   * Default: `undefined` (no explicit rate limiting).
   */
  maxQueriesPerSecond?: number;

  /**
   * Whether to automatically start a worker to process queued notifications.
   * If `true`, a worker will be created to process jobs from the queue.
   * If `false`, the user must manually start a worker elsewhere.
   * Default: `false`.
   */
  startWorker?: boolean;

  /**
   * Whether to track responses from notification APIs (e.g., success/fail reasons).
   * If `true`, responses will be stored in Redis for analytics/debugging.
   * If `false`, responses will not be stored.
   * Default: `false`.
   */
  trackResponses?: boolean;

  /**
   * The Redis key under which response tracking statistics will be stored.
   * Example: `"notifications:stats"`
   * Default: `undefined` (auto-generates a default key).
   */
  trackingKey?: string;

  /**
   * Whether to enable logging for the SDK.
   * If `true`, logs will be printed for debugging.
   * If `false`, logs will be suppressed.
   * Default: `true`.
   */
  loggingEnabled?: boolean;

  /** Allows users to provide a custom notifier instance */
  customNotifier?: NotificationChannel;
}

export async function dispatchNotifications<
  T,
  N extends keyof NotificationMeta
>(options: DispatchNotificationOptions<T, N>): Promise<void> {
  // 1. Initialize Redis externally.
  RedisClient.setInstance(options.redisInstance);

  // 2. Configure Logger
  Logger.enableLogging(options.loggingEnabled ?? true); // Default: logging is ON

  // 3. Create the notifier instance based on the specified type.
  let notifier: NotificationChannel;

  if (options.customNotifier) {
    notifier = options.customNotifier; // ✅ Use custom notifier if provided
  } else {
    switch (options.notifierType) {
      case "firebase":
        notifier = new FirebaseNotifier(options.notifierOptions);
        break;
      case "telegram":
        notifier = new TelegramNotifier(options.notifierOptions);
        break;
      case "email":
        notifier = new EmailNotifier(options.notifierOptions);
        break;
      case "web":
        notifier = new WebPushNotifier(options.notifierOptions);
        break;
      default:
        throw new Error("Unsupported notifier type");
    }
  }
  // 4. Register the notifier before enqueueing jobs
  NotifierRegistry.register(options.notifierType, notifier);

  const rateLimiter = options.maxQueriesPerSecond
    ? new TokenBucketRateLimiter(options.maxQueriesPerSecond)
    : null;

  // 5. Process records in batches until no more results.
  await processInBatches<T>(
    // options.dbQuery,
    async (offset, limit) => {
      if (rateLimiter) {
        await rateLimiter.acquire(); // Apply rate limiting
      }
      return await retryWithBackoff(() => options.dbQuery(offset, limit));
    },
    async (records: T[]) => {
      const userIds = records.map(options.mapRecordToUserId);
      await QueueManager.enqueueJob(options.queueName, options.jobName, {
        userIds,
        channel: options.notifierType,
        meta: records.map((record) => options.meta(record)),
        trackResponses: options.trackResponses,
        trackingKey: options.trackingKey || "notifications:stats",
      });
    },
    {
      batchSize: options.batchSize,
      maxQueriesPerSecond: options.maxQueriesPerSecond,
    }
  );

  // 6. Optionally start the worker to process the enqueued jobs.
  if (options.startWorker) {
    new WorkerManager({ queueName: options.queueName });
  }
}
