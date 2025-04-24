import { Redis, RedisOptions } from "ioredis";
import { Job, WorkerOptions as BullMQWorkerOptions } from "bullmq";
import { NotifierRegistry } from "../core/NotifierRegistry";
import { TelegramNotifier } from "../jobs/channels/TelegramNotifier";
import { WorkerManager } from "../core/WorkerManager";
import { EmailNotifier } from "../jobs/channels/EmailNotifier";
import { FirebaseNotifier } from "../jobs/channels/FirebaseNotifier";
import { WebPushNotifier } from "../jobs/channels/WebPushNotifier";
import { resetNotificationStats } from "./ResponseTrackers";
import { ServiceAccount } from "firebase-admin";
import { ensureRedisInstance } from "./RedisHandler";
import { loggerFactory } from "./LoggerFactory";
import { Logger as PinoLogger } from "pino";

const notifierMap = {
  telegram: TelegramNotifier,
  email: EmailNotifier,
  firebase: FirebaseNotifier,
  web: WebPushNotifier,
};

export interface WorkerConfig {
  redisConnection: Redis | RedisOptions;
  queueName: string;
  concurrency?: number;
  trackingKey?: string;
  notifiers?: {
    telegram?: { botToken: string };
    email?: {
      host: string;
      port: number;
      secure: boolean;
      auth: { user: string; pass: string };
      from: string;
    };
    firebase?: ServiceAccount | string;
    web?: { publicKey: string; privateKey: string; contactEmail: string };
  };
  onStart?: (job: Job, logger: PinoLogger) => Promise<void> | void;
  onComplete?: (
    job: Job,
    stats: Record<string, string>,
    logger: PinoLogger
  ) => Promise<void> | void;
  resetStatsAfterCompletion?: boolean;
  onDrained?: (logger: PinoLogger) => Promise<void> | void;
  bullWorkerOptions?: Partial<BullMQWorkerOptions>;
}

/**
 * Initializes and starts a notification worker server.
 * Manages Redis connections, registers notifiers based on config, and creates the WorkerManager.
 *
 * Note: Graceful shutdown should be managed by the calling application by calling .close()
 * on the returned WorkerManager instance.
 *
 * @param {WorkerConfig} config - The configuration for the worker server.
 * @returns {WorkerManager} The initialized WorkerManager instance.
 * @throws {Error} If configuration is invalid or initialization fails.
 */
export function startWorkerServer(config: WorkerConfig): WorkerManager {
  const baseLogger = loggerFactory.createLogger({
    component: "StartWorkerServer",
    queue: config.queueName,
  });

  baseLogger.info("Starting worker server initialization...");

  if (!config.redisConnection) {
    const err = new Error("Missing 'redisConnection' in WorkerConfig");
    baseLogger.error({ err }, "Initialization failed.");
    throw err;
  }
  if (!config.queueName) {
    const err = new Error("Missing 'queueName' in WorkerConfig");
    baseLogger.error({ err }, "Initialization failed.");
    throw err;
  }

  baseLogger.debug("Ensuring Redis instance...");
  let redisInstance: Redis;
  try {
    redisInstance = ensureRedisInstance(config.redisConnection, baseLogger);
    baseLogger.debug("Redis instance obtained/created.");
  } catch (redisError) {
    baseLogger.error({ err: redisError }, "Failed to obtain Redis instance.");
    throw redisError;
  }

  const notifiersToRegister = config.notifiers || {};
  const configuredNotifierKeys = Object.keys(notifiersToRegister);
  baseLogger.info(
    { configuredNotifiers: configuredNotifierKeys },
    "Registering configured notifiers..."
  );

  for (const [channel, options] of Object.entries(notifiersToRegister)) {
    if (!options) {
      baseLogger.trace(
        { channel },
        "Skipping channel with no options provided."
      );
      continue;
    }

    const notifierConstructor =
      notifierMap[channel as keyof typeof notifierMap];

    if (notifierConstructor) {
      baseLogger.debug({ channel }, `Instantiating notifier...`);
      try {
        let notifierInstance;
        if (channel === "firebase") {
          notifierInstance = new FirebaseNotifier(
            options as ServiceAccount | string
          );
        } else {
          notifierInstance = new notifierConstructor(options as any);
        }

        baseLogger.debug({ channel }, "Registering notifier instance...");
        NotifierRegistry.register(
          channel as keyof typeof notifierMap,
          notifierInstance
        );
      } catch (registrationError: any) {
        baseLogger.error(
          { err: registrationError, channel },
          `Failed to instantiate or register notifier.`
        );
      }
    } else {
      baseLogger.warn(
        { channel },
        `Unknown notifier type in configuration, skipping registration.`
      );
    }
  }

  const resolveTrackingKeyForJob = (job: Job | null): string => {
    return (
      job?.data?.trackingKey || config.trackingKey || "notifications:stats"
    );
  };

  baseLogger.debug("Creating WorkerManager instance...");
  try {
    const workerManager = new WorkerManager({
      redisConnection: redisInstance,
      queueName: config.queueName,
      concurrency: config.concurrency,
      trackingKey: config.trackingKey,
      bullWorkerOptions: config.bullWorkerOptions,

      onStart: config.onStart,

      onComplete: async (job, stats, jobLogger) => {
        jobLogger.debug(
          { stats },
          'WorkerManager "completed" event triggered.'
        );
        const currentTrackingKey = resolveTrackingKeyForJob(job);

        if (config.onComplete) {
          jobLogger.trace("Calling user onComplete callback...");
          try {
            await config.onComplete(job, stats, jobLogger);
          } catch (userCallbackError) {
            jobLogger.error(
              { err: userCallbackError },
              `Error in user-provided onComplete callback.`
            );
          }
        } else {
          jobLogger.info(
            { stats, trackingKey: currentTrackingKey },
            "Job finished. Notification stats retrieved."
          );
        }

        if (config.resetStatsAfterCompletion) {
          jobLogger.warn(
            { trackingKey: currentTrackingKey },
            "Resetting notification stats as configured..."
          );
          try {
            await resetNotificationStats(
              redisInstance,
              currentTrackingKey,
              jobLogger
            );
          } catch (resetError) {
            jobLogger.error(
              { err: resetError, trackingKey: currentTrackingKey },
              "Failed to reset stats."
            );
          }
        }
      },

      onDrained: config.onDrained,
    });

    baseLogger.info(
      "WorkerManager instance created successfully. Worker server setup complete."
    );
    return workerManager;
  } catch (managerError) {
    baseLogger.error(
      { err: managerError },
      "Failed to create WorkerManager instance."
    );
    throw managerError;
  }
}
