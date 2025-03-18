import { Worker, Job, Queue } from "bullmq";
import { RedisClient } from "../utils/RedisClient";
import { NotifierRegistry } from "./NotifierRegistry";
import {
  getNotificationStats,
  trackNotificationResponse,
} from "../utils/ResponseTrackers";
import Logger from "../utils/Logger";

interface WorkerConfig {
  queueName: string;
  concurrency?: number;
  onComplete?: (
    job: Job,
    stats: Record<string, string>
  ) => Promise<void> | void;
  onDrained?: () => Promise<void> | void;
}

export class WorkerManager {
  private worker: Worker;
  private queue: Queue;

  constructor(private config: WorkerConfig) {
    this.queue = new Queue(this.config.queueName, {
      connection: RedisClient.getInstance(),
    });

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

    this.worker.on("completed", async (job) => {
      Logger.log(`✅ Job completed successfully: ${job.id}`);

      if (this.config.onComplete) {
        const stats = await getNotificationStats(); // Fetch stats on completion
        await this.config.onComplete(job, stats);
      }
    });

    this.worker.on("failed", (job, error) => {
      Logger.error(`❌ Job failed (${job?.id}):`, error);
    });

    // NEW: Fired when the queue is fully drained (no more jobs)
    this.worker.on("drained", async () => {
      Logger.log(`✅ Queue "${this.config.queueName}" is fully drained!`);

      // Check if there are still active jobs before calling onDrained()
      let { active, waiting } = await this.queue.getJobCounts();

      while (active > 0 || waiting > 0) {
        Logger.log(
          `⏳ Still ${active} active jobs & ${waiting} waiting jobs...`
        );
        await new Promise((res) => setTimeout(res, 1000)); // Wait 1 sec
        ({ active, waiting } = await this.queue.getJobCounts()); // Re-check counts
      }

      Logger.log("✅ No active/waiting jobs remain. Queue is fully processed.");

      if (this.config.onDrained) {
        await this.config.onDrained();
      }
    });

    Logger.log(
      `🚀 Worker started listening on queue "${this.config.queueName}"`
    );
  }

  private async jobProcessor(job: Job): Promise<void> {
    const { userIds, channel, meta, trackResponses, trackingKey } = job.data;
    const notifier = NotifierRegistry.get(channel);
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
      throw error; // Ensure job fails properly
    }
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
  }
}
