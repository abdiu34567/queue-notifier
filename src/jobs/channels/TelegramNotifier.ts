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
    users: string[],
    meta: ExtraReplyMessage[]
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
    } as Partial<ExtraReplyMessage>;

    await Promise.all(
      users.map(async (user, index) => {
        try {
          const response = await this.rateLimiter.schedule(() =>
            this.bot.telegram.sendMessage(user, meta[index].text, sendOptions)
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
      })
    );

    return results;
  }
}
