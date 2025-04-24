import { JobsOptions, Queue } from "bullmq";
import Redis from "ioredis";
import { Logger as PinoLogger } from "pino";

interface NotificationJobData {
  userIds: string[];
  channel: string;
  meta: any[];
  trackResponses?: boolean;
  trackingKey: string;
  campaignId?: string;
}

export class QueueManager {
  /**
   * Enqueues a notification job using a transient Queue instance.
   *
   * @param redisConnection - The ioredis instance to use.
   * @param queueName - The name of the target queue.
   * @param jobName - The name/type of the job.
   * @param jobData - The data payload for the job.
   * @param logger - The Pino logger instance for contextual logging.
   * @param jobOptions - Optional BullMQ job options (delay, attempts, etc.).
   */
  static async enqueueJob(
    redisConnection: Redis,
    queueName: string,
    jobName: string,
    jobData: NotificationJobData,
    logger: PinoLogger,
    jobOptions?: JobsOptions
  ): Promise<void> {
    const enqueueLogger = logger.child({
      queue: queueName,
      jobName: jobName,
      campaignId: jobData.campaignId,
    });

    enqueueLogger.debug({ jobOptions }, "Attempting to enqueue job...");

    const queue = new Queue(queueName, { connection: redisConnection });

    try {
      const job = await queue.add(jobName, jobData, jobOptions);
      enqueueLogger.info(
        { jobId: job.id, userCount: jobData.userIds?.length ?? 0 },
        `Job enqueued successfully.`
      );
    } catch (error) {
      enqueueLogger.error({ err: error, jobOptions }, `Failed to enqueue job.`);
      throw error; // Re-throw the error to signal failure to the caller (retryWithBackoff)
    } finally {
      // Closing the queue instance immediately after adding a job is generally
      // not necessary and might have minor overhead. BullMQ handles connection
      // management internally. Avoid closing unless explicitly needed for resource cleanup
      // in very specific scenarios (which is unlikely here).
      // await queue.close();
      enqueueLogger.trace("Enqueue operation finished.");
    }
  }
}
