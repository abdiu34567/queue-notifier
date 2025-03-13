import Redis from "ioredis";
import RedisClient from "./utils/RedisClient";
import { processInBatches } from "./core/BatchProcessor";
import { QueueManager } from "./core/QueueManager";
import { WorkerManager } from "./core/WorkerManager";
import { FirebaseNotifier } from "./jobs/channels/FirebaseNotifier";
import { TelegramNotifier } from "./jobs/channels/TelegramNotifier";
import { EmailNotifier } from "./jobs/channels/EmailNotifier";
import { WebPushNotifier } from "./jobs/channels/WebPushNotifier";
import { NotifierRegistry } from "./core/NotifierRegistry";
import Logger from "./utils/Logger";

export interface RunBatchNotificationOptions<T> {
  redisInstance: Redis;
  notifierType: "firebase" | "telegram" | "email" | "web";
  notifierOptions: any; // Options for creating the notifier instance.
  dbQuery: (offset: number, limit: number) => Promise<T[]>;
  mapRecordToUserId: (record: T) => string;
  message: string;
  meta?: Record<string, any>;
  queueName: string;
  jobName: string;
  batchSize?: number;
  maxQueriesPerSecond?: number;
  startWorker?: boolean;
  trackResponses?: boolean; // Enable or disable tracking
  trackingKey?: string; // Custom Redis key for storing stats
  loggingEnabled?: boolean;
}

/**
 * Runs the entire batch notification process.
 *
 * - Initializes Redis with the given URL.
 * - Instantiates the specified notifier.
 * - Processes database records in batches using the provided dbQuery function.
 * - Maps each record to a user identifier.
 * - Enqueues a notification job for each batch.
 * - Optionally starts a worker to process the jobs.
 */
export async function dispatchNotifications<T>(
  options: RunBatchNotificationOptions<T>
): Promise<void> {
  // 1. Initialize Redis externally.
  RedisClient.setInstance(options.redisInstance);

  // 2. Configure Logger
  Logger.enableLogging(options.loggingEnabled ?? true); // Default: logging is ON

  // 3. Create the notifier instance based on the specified type.
  let notifier;
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

  // 4. Register the notifier before enqueueing jobs
  NotifierRegistry.register(options.notifierType, notifier);

  // 5. Process records in batches until no more results.
  await processInBatches<T>(
    options.dbQuery,
    async (records: T[]) => {
      const userIds = records.map(options.mapRecordToUserId);
      await QueueManager.enqueueJob(options.queueName, options.jobName, {
        userIds,
        message: options.message,
        channel: options.notifierType, // ✅ Ensure channel is stored
        meta: options.meta,
        trackResponses: options.trackResponses,
        trackingKey: options.trackingKey || "notifications:stats", // Default key
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
