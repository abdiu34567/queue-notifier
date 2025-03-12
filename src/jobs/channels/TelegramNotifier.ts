import { NotificationChannel } from "./NotificationChannel";
import { Telegraf } from "telegraf";
import { RateLimiter } from "../../core/RateLimiter";

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

  async send(userIds: string[], message: string): Promise<void> {
    const sendPromises = userIds.map((userId) =>
      this.rateLimiter.schedule(() =>
        this.bot.telegram
          .sendMessage(userId, message, { parse_mode: "Markdown" })
          .catch((err) =>
            console.error(`Telegram Error (User ${userId}):`, err)
          )
      )
    );

    await Promise.all(sendPromises);
  }
}
