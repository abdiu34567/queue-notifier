import { NotificationChannel, ExtraReplyMessage } from "./NotificationChannel";
import { Telegraf } from "telegraf";
import { RateLimiter } from "../../core/RateLimiter";
import Logger from "../../utils/Logger";
// import { ExtraReplyMessage } from "telegraf/typings/telegram-types";

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
    meta: ExtraReplyMessage
  ): Promise<
    { status: string; recipient: string; response?: any; error?: string }[]
  > {
    const results: any[] = [];

    // Default options for sending messages
    const defaultOptions = { parse_mode: "MarkdownV2" };

    // Allow additional Telegram options via meta.telegramOptions
    const extraOptions = meta || {};

    // Merge default and extra options (extraOptions takes precedence)
    const sendOptions = {
      ...defaultOptions,
      ...extraOptions,
    } as ExtraReplyMessage;

    await Promise.all(
      userIds.map(async (userId) => {
        try {
          const response = await this.rateLimiter.schedule(() =>
            this.bot.telegram.sendMessage(userId, meta.text, sendOptions)
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
