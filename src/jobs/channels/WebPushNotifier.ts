import webPush, {
  PushSubscription,
  RequestOptions,
  WebPushError,
} from "web-push";
import { loggerFactory } from "../../utils/LoggerFactory";
import { Logger as PinoLogger } from "pino";
import {
  NotificationChannel,
  NotificationResult,
  WebPushMeta,
} from "./NotificationChannel";
import { RateLimiter } from "../../core/RateLimiter";
import { batchSender } from "../../core/BatchSender";

interface WebPushNotifierConfig {
  publicKey: string;
  privateKey: string;
  contactEmail: string;
  maxMessagesPerSecond?: number;
}

export class WebPushNotifier implements NotificationChannel {
  private rateLimiter: RateLimiter;
  private baseLogger: PinoLogger;

  constructor(private config: WebPushNotifierConfig) {
    this.baseLogger = loggerFactory.createLogger({
      component: "WebPushNotifier",
    });
    this.baseLogger.info("Initializing...");

    if (!config.publicKey || !config.privateKey || !config.contactEmail) {
      const err = new Error(
        "WebPushNotifier requires publicKey, privateKey, and contactEmail."
      );
      this.baseLogger.error(
        { err },
        "Initialization failed due to missing VAPID details."
      );
      throw err;
    }

    try {
      webPush.setVapidDetails(
        "mailto:" + this.config.contactEmail,
        this.config.publicKey,
        this.config.privateKey
      );
      this.baseLogger.info("VAPID details set successfully.");
    } catch (err) {
      this.baseLogger.error({ err }, "Failed to set VAPID details.");
      throw err;
    }

    const maxMessagesPerSecond = config.maxMessagesPerSecond || 50; // Default ~50/sec
    this.rateLimiter = new RateLimiter(maxMessagesPerSecond, 1000);
    this.baseLogger.info(
      { rateLimit: maxMessagesPerSecond },
      "Rate limiter configured."
    );
  }

  /**
   * Sends Web Push notifications using the batchSender utility.
   */
  async send(
    subscriptionStrings: string[],
    meta: WebPushMeta[],
    logger: PinoLogger
  ): Promise<NotificationResult[]> {
    return batchSender.process(
      subscriptionStrings,
      meta,
      this.rateLimiter,
      this._sendSingleWebPush.bind(this),
      logger,
      { concurrency: 5 }
    );
  }

  /**
   * Parses subscription, validates meta, and sends a single Web Push notification.
   * Called by batchSender.
   * @param subString The PushSubscription object as a JSON string.
   * @param userMeta Metadata for this specific notification.
   * @param taskLogger Logger instance with context for this specific task.
   * @returns A NotificationResult object.
   */
  private async _sendSingleWebPush(
    subString: string,
    userMeta: WebPushMeta,
    taskLogger: PinoLogger
  ): Promise<NotificationResult> {
    let subscription: PushSubscription;
    let endpoint = `unparseable_sub_at_index_${
      taskLogger.bindings().index ?? "?"
    }`; // Default recipient if parsing fails

    try {
      if (!subString || typeof subString !== "string") {
        throw new Error("Subscription string is missing or not a string.");
      }
      subscription = JSON.parse(subString) as PushSubscription;
      if (
        !subscription ||
        typeof subscription !== "object" ||
        !subscription.endpoint ||
        !subscription.keys?.p256dh ||
        !subscription.keys?.auth
      ) {
        throw new Error(
          "Parsed subscription object is invalid or missing required keys."
        );
      }
      endpoint = subscription.endpoint;
      taskLogger.setBindings({ recipientEndpoint: endpoint });
      taskLogger.trace("Subscription string parsed successfully.");
    } catch (parseError: any) {
      taskLogger.warn(
        { err: parseError, inputString: subString?.substring(0, 50) + "..." },
        "Skipping invalid or unparseable subscription string."
      );
      return {
        status: "error",
        recipient: endpoint,
        error: "INVALID_SUBSCRIPTION_STRING",
        response: parseError.message,
      };
    }

    if (!userMeta || typeof userMeta !== "object") {
      taskLogger.warn(
        "Skipping subscription due to missing or invalid meta object."
      );
      return {
        status: "error",
        recipient: endpoint,
        error: "INVALID_META",
        response: "Missing or invalid meta for recipient",
      };
    }
    if (!userMeta.title && !userMeta.body && !userMeta.data) {
      taskLogger.warn(
        "Meta lacks title, body, and data. Sending potentially empty notification."
      );
      userMeta.title = userMeta.title || "Notification";
    }

    try {
      const pushPayload = JSON.stringify({
        title: userMeta.title,
        body: userMeta.body || "",
        icon: userMeta.icon,
        image: userMeta.image,
        badge: userMeta.badge,
        data: userMeta.data || {},
      });

      const requestOptions: RequestOptions = {};
      if (userMeta.TTL !== undefined) requestOptions.TTL = userMeta.TTL;
      if (userMeta.headers) requestOptions.headers = userMeta.headers;

      taskLogger.trace(
        { options: requestOptions, payloadSize: pushPayload.length },
        "Sending notification via web-push..."
      );
      const response = await webPush.sendNotification(
        subscription,
        pushPayload,
        requestOptions
      );
      taskLogger.debug(
        { statusCode: response.statusCode },
        "Web Push sent successfully."
      );

      return {
        status: "success",
        recipient: endpoint,
        response: {
          statusCode: response.statusCode,
          headers: response.headers,
        },
      };
    } catch (error) {
      let errorMessage = "Unknown web-push error";
      let statusCode: string | number = "N/A";

      if (error instanceof WebPushError) {
        errorMessage = error.body || error.message;
        statusCode = error.statusCode;
        taskLogger.warn(
          { err: error, statusCode },
          `Web Push send failed (WebPushError).`
        );
      } else if (error instanceof Error) {
        errorMessage = error.message;
        taskLogger.warn({ err: error }, `Web Push send failed (Error).`);
      } else {
        try {
          errorMessage = JSON.stringify(error);
        } catch {}
        taskLogger.warn(
          { error: error },
          `Web Push send failed (Unknown error type).`
        );
      }

      // Sanitize the full original error message slightly for use as a key part
      const sanitizedMessage = errorMessage
        .replace(/\s+/g, "_")
        .replace(/[.:;,*+?^${}()|[\]\\]/g, "");

      // Construct the key BODY: <StatusCode>:<SanitizedFullErrorMessage>
      const errorKeyBody = `${statusCode}:${sanitizedMessage}`;

      return {
        status: "error",
        recipient: endpoint,
        error: errorKeyBody.substring(0, 255),
        response: {
          message: errorMessage,
          statusCode: statusCode,
          originalError: error,
        },
      };
    }
  }
}
