import {
  Worker,
  Job,
  Queue,
  WorkerOptions as BullMQWorkerOptions,
} from "bullmq";
import { NotifierRegistry } from "./NotifierRegistry";
import {
  getNotificationStats,
  trackNotificationResponse,
} from "../utils/ResponseTrackers";
import { loggerFactory } from "../utils/LoggerFactory";
import { Logger as PinoLogger } from "pino";
import Redis, { RedisOptions } from "ioredis";
import { ensureRedisInstance } from "../utils/RedisHandler";

export interface WorkerManagerConfig {
  redisConnection: Redis | RedisOptions;
  queueName: string;
  concurrency?: number;
  trackingKey?: string;
  onStart?: (job: Job, logger: PinoLogger) => Promise<void> | void;
  onComplete?: (
    job: Job,
    stats: Record<string, string>,
    logger: PinoLogger
  ) => Promise<void> | void;
  onDrained?: (logger: PinoLogger) => Promise<void> | void;
  bullWorkerOptions?: Partial<BullMQWorkerOptions>;
}

export class WorkerManager {
  private worker: Worker;
  private queue: Queue;
  private redisInstance: Redis;
  private ownsRedisConnection: boolean;
  private logger: PinoLogger;

  constructor(private config: WorkerManagerConfig) {
    this.logger = loggerFactory.createLogger({
      component: "WorkerManager",
      queue: config.queueName,
    });

    this.logger.info("Initializing...");

    // Determine if we created the Redis instance or were given one
    this.ownsRedisConnection = !(config.redisConnection instanceof Redis);
    try {
      this.redisInstance = ensureRedisInstance(
        config.redisConnection,
        this.logger
      );
    } catch (err) {
      this.logger.error({ err }, "Failed to ensure Redis instance.");
      throw err; // Cannot proceed without Redis
    }

    // Setup Redis listeners using the instance logger
    this.redisInstance.on("connect", () => {
      this.logger.info("Redis connected.");
    });
    this.redisInstance.on("error", (error) => {
      this.logger.error({ err: error }, "Redis connection error.");
    });

    // Setup BullMQ Queue
    try {
      this.queue = new Queue(this.config.queueName, {
        connection: this.redisInstance,
      });
      this.logger.debug("BullMQ Queue instance created.");
    } catch (err) {
      this.logger.error({ err }, "Failed to create BullMQ Queue instance.");
      throw err;
    }

    // Setup BullMQ Worker
    const workerOptions: BullMQWorkerOptions = {
      connection: this.redisInstance,
      concurrency: this.config.concurrency || 10,
      ...(this.config.bullWorkerOptions || {}),
    };

    try {
      this.worker = new Worker(
        this.config.queueName,
        this.jobProcessor.bind(this), // jobProcessor needs this.logger
        workerOptions
      );
      this.logger.debug(
        { options: workerOptions },
        "BullMQ Worker instance created."
      );
    } catch (err) {
      this.logger.error(
        { err, options: workerOptions },
        "Failed to create BullMQ Worker instance."
      );
      throw err;
    }

    // --- Setup Event Listeners ---
    this.worker.on("active", async (job: Job) => {
      const jobLogger = this.logger.child({
        jobId: job.id,
        jobName: job.name,
        campaignId: job.data.campaignId,
      });
      jobLogger.info("Job started processing.");
      if (this.config.onStart) {
        try {
          await this.config.onStart(job, jobLogger);
        } catch (error) {
          jobLogger.error(
            { err: error },
            `Error in user-provided onStart callback.`
          );
        }
      }
    });

    this.worker.on("completed", async (job) => {
      const jobLogger = this.logger.child({
        jobId: job.id,
        jobName: job.name,
        campaignId: job.data.campaignId,
      });
      jobLogger.info("Job completed successfully.");

      if (!job) {
        this.logger.warn(
          "Received 'completed' event with undefined job object."
        ); // WARN if job is missing
        return;
      }

      if (this.config.onComplete) {
        const resolvedTrackingKey =
          job.data.trackingKey ||
          this.config.trackingKey ||
          "notifications:stats";
        try {
          const stats = await getNotificationStats(
            this.redisInstance,
            resolvedTrackingKey,
            jobLogger
          );
          await this.config.onComplete(job, stats, jobLogger);
        } catch (error) {
          jobLogger.error(
            { err: error, trackingKey: resolvedTrackingKey },
            `Error retrieving stats or executing user-provided onComplete callback.`
          );
        }
      }
    });

    this.worker.on("failed", (job, error) => {
      // Create logger even for failed job if possible
      const jobLogger = this.logger.child({
        jobId: job?.id,
        jobName: job?.name,
        campaignId: job?.data?.campaignId,
      });
      jobLogger.error({ err: error }, `Job failed.`);
    });

    this.worker.on("drained", async () => {
      this.logger.debug(
        'Internal "drained" event received. Checking job counts...'
      );
      let checkCount = 0;
      const maxChecks = 10;
      try {
        while (checkCount < maxChecks) {
          const counts = await this.queue.getJobCounts(
            "active",
            "waiting",
            "delayed"
          );
          if (
            counts.active === 0 &&
            counts.waiting === 0 &&
            counts.delayed === 0
          ) {
            this.logger.debug(
              `Queue confirmed empty after ${checkCount + 1} check(s).`
            );
            if (this.config.onDrained) {
              this.logger.debug("Calling user onDrained callback.");
              try {
                await this.config.onDrained(this.logger);
              } catch (callbackError) {
                this.logger.error(
                  { err: callbackError },
                  "Error in user-provided onDrained callback."
                );
              }
            }
            return;
          }
          checkCount++;
          this.logger.trace(
            {
              active: counts.active,
              waiting: counts.waiting,
              delayed: counts.delayed,
            },
            `Drain check ${checkCount}: Queue not empty...`
          );
          await new Promise((res) => setTimeout(res, 1500));
        }
        this.logger.warn(
          { queue: this.config.queueName },
          `Queue did not appear fully drained after ${maxChecks} checks.`
        );
      } catch (countError) {
        this.logger.error(
          { err: countError },
          "Error checking job counts during drained event."
        );
      }
    });

    const finalConcurrency =
      workerOptions.concurrency ?? this.config.concurrency ?? 10; // Get the final value reliably
    this.logger.info({ concurrency: finalConcurrency }, `Worker listening.`);
  }

  private async jobProcessor(job: Job): Promise<void> {
    const jobLogger = this.logger.child({
      jobId: job.id,
      jobName: job.name,
      campaignId: job.data.campaignId,
      channel: job.data.channel,
    });

    jobLogger.debug("Processing job payload.");

    const campaignId = job.data.campaignId as string | undefined;
    if (campaignId) {
      const cancelKey = `worker:cancel:campaign:${campaignId}`;
      try {
        const cancelStatus = await this.redisInstance.get(cancelKey);
        if (cancelStatus === "true") {
          jobLogger.info({ cancelKey }, "Job cancelled via flag.");
          return; // Exit successfully
        }
      } catch (redisError) {
        jobLogger.warn(
          { err: redisError, cancelKey },
          "Could not check cancellation status due to Redis error. Proceeding."
        );
      }
    }

    const { userIds, channel, meta, trackResponses, trackingKey } = job.data;
    const resolvedTrackingKey =
      trackingKey || this.config.trackingKey || "notifications:stats";

    try {
      if (!Array.isArray(userIds)) {
        jobLogger.error(`Job has invalid or missing userIds data.`);
        throw new Error(`Invalid userIds data in job ${job.id}`);
      }

      const notifier = NotifierRegistry.get(channel);

      const response = await notifier.send(userIds, meta, jobLogger);

      if (trackResponses && response) {
        await trackNotificationResponse(
          this.redisInstance,
          resolvedTrackingKey,
          response,
          jobLogger
        );
      }
      jobLogger.debug("Notifier send task completed.");
    } catch (error: any) {
      jobLogger.error(
        { err: error },
        `Error during notification send or tracking.`
      );
      if (trackResponses) {
        const errorResponse = {
          success: false,
          error: error.message || "Unknown processing error",
        };
        await trackNotificationResponse(
          this.redisInstance,
          resolvedTrackingKey,
          errorResponse,
          jobLogger
        );
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    this.logger.info(`Closing worker and queue...`);
    try {
      await this.worker.close();
      this.logger.debug(`Worker closed.`);
      await this.queue.close();
      this.logger.debug(`Queue instance closed.`);

      if (
        this.ownsRedisConnection &&
        (this.redisInstance.status === "ready" ||
          this.redisInstance.status === "connecting")
      ) {
        await this.redisInstance.quit();
        this.logger.info(`Internally created Redis connection closed.`);
      } else if (!this.ownsRedisConnection) {
        this.logger.debug(
          `External Redis connection not closed by WorkerManager.`
        );
      }
    } catch (error) {
      this.logger.error(
        { err: error },
        `Error during WorkerManager close sequence.`
      );
    } finally {
      this.logger.info(`WorkerManager shutdown sequence complete.`);
    }
  }
}
