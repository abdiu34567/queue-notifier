import { Redis } from "ioredis";
import { RedisClient } from "./RedisClient";
import { NotifierRegistry } from "../core/NotifierRegistry";
import { TelegramNotifier } from "../jobs/channels/TelegramNotifier";
import { WorkerManager } from "../core/WorkerManager";
import { EmailNotifier } from "../jobs/channels/EmailNotifier";
import { FirebaseNotifier } from "../jobs/channels/FirebaseNotifier";
import { WebPushNotifier } from "../jobs/channels/WebPushNotifier";
import Logger from "./Logger";
import { resetNotificationStats } from "./ResponseTrackers";

interface WorkerConfig {
  redisInstance: Redis;
  queueName: string;
  concurrency?: number;
  notifiers?: {
    telegram?: { botToken: string };
    email?: {
      host: string;
      port: number;
      secure: boolean;
      auth: { user: string; pass: string };
      from: string;
    };
    firebase?: { serviceAccount: any };
    web?: { publicKey: string; privateKey: string; contactEmail: string };
  };
  onComplete?: (
    job: any,
    stats: Record<string, string>
  ) => Promise<void> | void;
  resetStatsAfterCompletion?: boolean;
  onDrained?: () => Promise<void> | void;
}

export function startWorkerServer(config: WorkerConfig): void {
  // Set Redis instance in SDK
  RedisClient.setInstance(config.redisInstance);

  // **Dynamically register all notifiers provided by the user**
  const notifierMap = {
    telegram: TelegramNotifier,
    email: EmailNotifier,
    firebase: FirebaseNotifier,
    web: WebPushNotifier,
  };

  for (const [channel, options] of Object.entries(config.notifiers || {})) {
    if (notifierMap[channel as keyof typeof notifierMap]) {
      NotifierRegistry.register(
        channel as keyof typeof notifierMap,
        new notifierMap[channel as keyof typeof notifierMap](options as any)
      );
      Logger.log(`✅ Registered notifier: ${channel}`);
    } else {
      Logger.log(
        `⚠️ Unknown notifier type: ${channel}, skipping registration.`
      );
    }
  }

  // Start Worker
  new WorkerManager({
    queueName: config.queueName,
    concurrency: config.concurrency || 10,
    onComplete: async (job, stats) => {
      Logger.log(`📊 Job ${job.id} completed. Notification stats:`, stats);

      if (config.onComplete) {
        await config.onComplete(job, stats);
      }

      if (config.resetStatsAfterCompletion) {
        await resetNotificationStats();
      }
    },
    onDrained: async () => {
      Logger.log(
        `✅ Queue "${config.queueName}" is fully drained. No more jobs!`
      );
      if (config.onDrained) {
        await config.onDrained();
      }
    },
  });
}
