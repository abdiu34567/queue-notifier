import { NotificationChannel } from "./NotificationChannel";
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
    userIds: string[],
    message: string
  ): Promise<
    { status: string; recipient: string; response?: any; error?: string }[]
  > {
    const results: any[] = [];

    await Promise.all(
      userIds.map(async (userId) => {
        try {
          const response = await this.rateLimiter.schedule(() =>
            this.bot.telegram.sendMessage(userId, message, {
              parse_mode: "Markdown",
            })
          );

          Logger.log(`📨 Telegram message sent to ${userId}:`, response);
          results.push({ status: "success", recipient: userId, response });
        } catch (error: any) {
          Logger.error(`❌ Telegram Error (User ${userId}):`, error.message);
          results.push({
            status: "failed",
            recipient: userId,
            error: error.message,
          });
        }
      })
    );

    return results;
  }
}
