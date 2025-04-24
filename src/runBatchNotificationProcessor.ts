import Redis, { RedisOptions } from "ioredis";
import { processInBatches, retryWithBackoff } from "./core/BatchProcessor";
import { QueueManager } from "./core/QueueManager";
import { loggerFactory } from "./utils/LoggerFactory";
import {
  NotificationChannel,
  NotificationMeta,
  RequiredMeta,
} from "./jobs/channels/NotificationChannel";
import { TokenBucketRateLimiter } from "./core/RateLimiter";
import { JobsOptions } from "bullmq";
import { ensureRedisInstance } from "./utils/RedisHandler";

const dispatchLogger = loggerFactory.createLogger({
  component: "DispatchNotifications",
});

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
   * Redis connection configuration.
   * Provide either an existing ioredis instance or connection options
   * (e.g., { host: 'localhost', port: 6379 }).
   * If options are provided, a new connection will be established.
   */
  redisConnection: Redis | RedisOptions;

  /**
   * The notification channel to be used for sending messages.
   * Available options: "firebase", "telegram", "email", "web".
   */
  channelName: N;

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

  /**
   * Optional identifier for a specific campaign or broadcast instance.
   * If provided, this ID can be used to cancel all jobs associated with
   * this specific campaign instance via a Redis flag.
   * Example: "summer-promo-2024"
   */
  campaignId?: string;

  /**
   * Optional BullMQ job options to control job behavior,
   * especially retry strategies for workers.
   * Example: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } }
   * These will be merged with default options like delay, removeOnComplete.
   */
  jobOptions?: JobsOptions;

  /** Max retries for the enqueue operation itself */
  enqueueRetries?: number;

  /** Initial delay (ms) for enqueue retries */
  enqueueBaseDelay?: number;
}

export async function dispatchNotifications<
  T,
  N extends keyof NotificationMeta
>(options: DispatchNotificationOptions<T, N>): Promise<void> {
  dispatchLogger.info(
    {
      queue: options.queueName,
      jobName: options.jobName,
      channel: options.channelName,
      campaignId: options.campaignId,
    },
    "Dispatch process starting..."
  );

  let redisInstance: Redis;
  try {
    redisInstance = ensureRedisInstance(
      options.redisConnection,
      dispatchLogger
    );
  } catch (error: any) {
    dispatchLogger.error(
      { err: error },
      `Failed to initialize Redis connection.`
    );
    throw new Error(`Failed to initialize Redis: ${error.message}`);
  }

  const rateLimiter = options.maxQueriesPerSecond
    ? new TokenBucketRateLimiter(options.maxQueriesPerSecond, dispatchLogger)
    : null;

  // Define the retry parameters for enqueueing, using options or defaults, Default to 3 retries
  const enqueueMaxRetries = options.enqueueRetries ?? 3;
  const enqueueRetryBaseDelay = options.enqueueBaseDelay ?? 200;

  let totalRecordsProcessed = 0;
  try {
    await processInBatches<T>(
      async (offset, limit) => {
        if (rateLimiter) {
          await rateLimiter.acquire();
        }
        return await retryWithBackoff(
          () => options.dbQuery(offset, limit),
          dispatchLogger,
          "DatabaseQuery"
        );
      },
      async (records: T[]) => {
        if (records.length === 0) {
          dispatchLogger.trace(
            "Received empty batch from database, skipping enqueue."
          );
          return;
        }

        totalRecordsProcessed += records.length;

        const userIds = records.map(options.mapRecordToUserId);
        const jobPayload = {
          userIds,
          channel: options.channelName,
          meta: records.map((record) => {
            try {
              return options.meta(record);
            } catch (metaError: any) {
              dispatchLogger.error(
                { err: metaError, record },
                `Error generating meta for record`
              );
              return {};
            }
          }),
          trackResponses: options.trackResponses,
          trackingKey: options.trackingKey || "notifications:stats",
          campaignId: options.campaignId,
        };

        const finalJobOptions: JobsOptions = {
          removeOnComplete: true,
          removeOnFail: false,

          ...(options.jobOptions || {}),
        };

        try {
          await retryWithBackoff(
            async () => {
              await QueueManager.enqueueJob(
                redisInstance,
                options.queueName,
                options.jobName,
                jobPayload,
                dispatchLogger,
                finalJobOptions
              );
            },
            dispatchLogger,
            "EnqueueJobBatch",
            enqueueMaxRetries,
            enqueueRetryBaseDelay
          );
        } catch (enqueueError) {
          throw enqueueError;
        }
      },
      dispatchLogger,
      {
        batchSize: options.batchSize,
      }
    );
  } catch (error) {
    throw error;
  } finally {
    if (!(options.redisConnection instanceof Redis)) {
      dispatchLogger.debug(
        { status: redisInstance.status },
        "Checking status of internally created Redis connection for cleanup."
      );
      if (
        redisInstance.status === "ready" ||
        redisInstance.status === "connecting"
      ) {
        try {
          await redisInstance.quit();
          dispatchLogger.info("Internally created Redis connection closed.");
        } catch (quitError) {
          dispatchLogger.warn(
            { err: quitError },
            "Error attempting to quit internally created Redis connection."
          );
        }
      } else {
        dispatchLogger.debug(
          "Internally created Redis connection not in quittable state, skipping quit."
        );
      }
    } else {
      dispatchLogger.debug(
        "External Redis connection provided, skipping cleanup."
      );
    }
    dispatchLogger.info("Dispatch process finished."); // Final log
  }
}
