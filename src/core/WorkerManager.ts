import { Worker, Job } from "bullmq";
import RedisClient from "../utils/RedisClient";
import { NotifierRegistry } from "./NotifierRegistry";

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
      console.log(`✅ Job completed successfully: ${job.id}`);
    });

    this.worker.on("failed", (job, error) => {
      console.error(`❌ Job failed (${job?.id}):`, error);
    });

    console.log(
      `🚀 Worker started listening on queue "${this.config.queueName}"`
    );
  }

  private async jobProcessor(job: Job): Promise<void> {
    const { userIds, message, channel, meta } = job.data;

    const notifier = NotifierRegistry.get(channel);
    await notifier.send(userIds, message, meta);
  }

  async close(): Promise<void> {
    await this.worker.close();
  }
}
