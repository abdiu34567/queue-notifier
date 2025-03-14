import { Worker, Job } from "bullmq";
import RedisClient from "../utils/RedisClient";
import { NotifierRegistry } from "./NotifierRegistry";
import { trackNotificationResponse } from "../utils/ResponseTrackers";
import Logger from "../utils/Logger";

interface WorkerConfig {
  queueName: string;
  concurrency?: number;
}

export class WorkerManager {
  private worker: Worker;

  constructor(private config: WorkerConfig) {
    this.worker = new Worker(
      this.config.queueName,
      this.jobProcessor.bind(this),
      {
        connection: {
          ...RedisClient.getInstance().options,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        },
        concurrency: this.config.concurrency || 10,
      }
    );

    this.worker.on("completed", (job) => {
      Logger.log(`✅ Job completed successfully: ${job.id}`);
    });

    this.worker.on("failed", (job, error) => {
      Logger.error(`❌ Job failed (${job?.id}):`, error);
    });

    Logger.log(
      `🚀 Worker started listening on queue "${this.config.queueName}"`
    );
  }

  private async jobProcessor(job: Job): Promise<void> {
    const { userIds, channel, meta, trackResponses, trackingKey } = job.data;
    const notifier = NotifierRegistry.get(channel);
    console.log(userIds, channel, meta);
    try {
      const response = await notifier.send(userIds, meta);
      if (trackResponses && response) {
        await trackNotificationResponse(trackingKey, response);
      }
    } catch (error: any) {
      Logger.error(`❌ Notification failed: ${error.message}`);
      if (trackResponses) {
        await trackNotificationResponse(trackingKey, {
          success: false,
          error: error.message,
        });
      }
    }
  }

  async close(): Promise<void> {
    await this.worker.close();
  }
}
