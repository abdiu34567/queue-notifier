import { Queue } from "bullmq";
import { RedisClient } from "../utils/RedisClient";

export class QueueManager {
  private static queues: Map<string, Queue> = new Map();

  static createQueue(queueName: string): Queue {
    if (!QueueManager.queues.has(queueName)) {
      const connection = RedisClient.getInstance();
      const queue = new Queue(queueName, { connection });
      QueueManager.queues.set(queueName, queue);
    }

    return QueueManager.queues.get(queueName)!;
  }

  static async enqueueJob(
    queueName: string,
    jobName: string,
    jobData: object
  ): Promise<void> {
    const queue = QueueManager.createQueue(queueName);
    await queue.add(jobName, jobData, {
      removeOnComplete: true,
      removeOnFail: false,
    });
  }
}
