import { Telegraf } from "telegraf";
import { Logger as PinoLogger } from "pino";
import { loggerFactory } from "../../utils/LoggerFactory";
import {
  NotificationChannel,
  NotificationResult,
  TelegramMeta,
} from "./NotificationChannel";
import { RateLimiter } from "../../core/RateLimiter";
import { batchSender } from "../../core/BatchSender";

interface TelegramNotifierConfig {
  botToken: string;
  maxMessagesPerSecond?: number;
}

export class TelegramNotifier implements NotificationChannel {
  private bot: Telegraf;
  private rateLimiter: RateLimiter;
  private baseLogger: PinoLogger;

  constructor(private config: TelegramNotifierConfig) {
    this.baseLogger = loggerFactory.createLogger({
      component: "TelegramNotifier",
    });
    this.baseLogger.info("Initializing...");

    if (!config.botToken) {
      const err = new Error("Telegram botToken is required.");
      this.baseLogger.error({ err }, "Initialization failed.");
      throw err;
    }

    try {
      this.bot = new Telegraf(config.botToken);
      this.baseLogger.info("Telegraf instance created.");
    } catch (err) {
      this.baseLogger.error({ err }, "Failed to create Telegraf instance.");
      throw err;
    }

    const maxMessagesPerSecond = config.maxMessagesPerSecond || 25; // Default 25/sec for Telegram
    this.rateLimiter = new RateLimiter(maxMessagesPerSecond, 1000);
    this.baseLogger.info(
      { rateLimit: maxMessagesPerSecond },
      "Rate limiter configured."
    );
  }

  /**
   * Sends Telegram messages using the batchSender utility.
   */
  async send(
    chatIds: string[],
    meta: TelegramMeta[],
    logger: PinoLogger
  ): Promise<NotificationResult[]> {
    return batchSender.process(
      chatIds,
      meta,
      this.rateLimiter,
      this._sendSingleTelegramMessage.bind(this),
      logger,
      { concurrency: 5 }
    );
  }

  /**
   * Sends a single Telegram message. Called by batchSender.
   * @param chatId Recipient chat ID.
   * @param userMeta Metadata for this specific message.
   * @param taskLogger Logger instance with context for this specific task.
   * @returns A NotificationResult object.
   */
  private async _sendSingleTelegramMessage(
    chatId: string,
    userMeta: TelegramMeta,
    taskLogger: PinoLogger
  ): Promise<NotificationResult> {
    if (!userMeta || !userMeta.text) {
      taskLogger.warn("Missing text in Telegram meta.");
      return { status: "error", recipient: chatId, error: "MISSING_TEXT" };
    }

    const messageText = userMeta.text;
    const { text, ...sendOptions } = userMeta;
    const finalSendOptions: Partial<
      Parameters<typeof this.bot.telegram.sendMessage>[2]
    > = {
      parse_mode: "HTML", // Default parse mode
      ...sendOptions, // Spread remaining meta fields as options
    };

    try {
      taskLogger.trace(
        { options: finalSendOptions },
        "Sending message via Telegraf..."
      );
      const response = await this.bot.telegram.sendMessage(
        chatId,
        messageText,
        finalSendOptions
      );
      taskLogger.debug(
        { messageId: response.message_id },
        "Telegram message sent successfully."
      );

      return {
        status: "success",
        recipient: chatId,
        response: response,
      };
    } catch (error: any) {
      let errorMessage =
        error.description || error.message || "Unknown Telegram error";
      let statusCode: string | number =
        error.code || error.response?.error_code || "N/A";

      taskLogger.warn(
        { err: error, statusCode, description: error.description },
        `Telegram send error.`
      );

      // Sanitize the full original error message slightly
      const sanitizedMessage = errorMessage
        .replace(/\s+/g, "_")
        .replace(/[.:;,*+?^${}()|[\]\\]/g, "");

      // Construct the key BODY: <StatusCode>:<SanitizedFullErrorMessage>
      const errorKeyBody = `${statusCode}:${sanitizedMessage}`;

      return {
        status: "error",
        recipient: chatId,
        error: errorKeyBody.substring(0, 255),
        response: {
          message: error.message,
          description: error.description,
          code: error.code,
          responsePayload: error.response,
        },
      };
    }
  }
}
