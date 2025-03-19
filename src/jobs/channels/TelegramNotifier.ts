import { NotificationChannel, ExtraReplyMessage } from "./NotificationChannel";
import { Telegraf } from "telegraf";
import { RateLimiter } from "../../core/RateLimiter";
import Logger from "../../utils/Logger";

interface TelegramNotifierConfig {
  botToken: string;
  maxMessagesPerSecond?: number;
}

export class TelegramNotifier implements NotificationChannel {
  private bot: Telegraf;
  private rateLimiter: RateLimiter;

  constructor(private config: TelegramNotifierConfig) {
    this.bot = new Telegraf(config.botToken);
    this.rateLimiter = new RateLimiter(config.maxMessagesPerSecond || 25, 1000);
  }

  async send(
    users: string[],
    meta: ExtraReplyMessage[]
  ): Promise<
    { status: string; recipient: string; response?: any; error?: string }[]
  > {
    const results: {
      status: string;
      recipient: string;
      response?: any;
      error?: string;
    }[] = [];
    const maxConcurrentMessages = 5; // Limit concurrent Telegram messages
    const tasks: Promise<void>[] = [];

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const extraOptions = meta[i] || {};
      const sendOptions: Partial<ExtraReplyMessage> = {
        parse_mode: "MarkdownV2",
        ...extraOptions,
      };
      const messageText = meta[i]?.text || "No message content provided.";

      const task = this.rateLimiter.schedule(async () => {
        try {
          const response = await this.bot.telegram.sendMessage(
            user,
            messageText,
            sendOptions
          );
          Logger.log(`📨 Telegram message sent to ${user}:`, response);
          results.push({ status: "success", recipient: user, response });
        } catch (error: any) {
          Logger.error(`❌ Telegram Error (User ${user}):`, error.message);
          results.push({
            status: "failed",
            recipient: user,
            error: error.message,
          });
        }
      });

      tasks.push(task);

      // When we've reached our concurrency limit, wait for the batch to finish
      if (tasks.length === maxConcurrentMessages) {
        await Promise.all(tasks);
        tasks.length = 0; // Clear the tasks array
      }
    }

    // Await any remaining tasks that didn't form a full batch
    if (tasks.length > 0) {
      await Promise.all(tasks);
    }

    return results;
  }
}
