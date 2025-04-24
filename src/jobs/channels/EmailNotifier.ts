import nodemailer, { Transporter } from "nodemailer";
import Mail from "nodemailer/lib/mailer";
import { Logger as PinoLogger } from "pino";
import { RateLimiter } from "../../core/RateLimiter";
import {
  EmailMeta,
  NotificationChannel,
  NotificationResult,
} from "./NotificationChannel";
import { loggerFactory } from "../../utils/LoggerFactory";
import { batchSender } from "../../core/BatchSender";

interface EmailNotifierConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: string;
  maxEmailsPerSecond?: number;
}

export class EmailNotifier implements NotificationChannel {
  private transporter: Transporter;
  private rateLimiter: RateLimiter;
  private config: EmailNotifierConfig;
  private baseLogger?: PinoLogger;

  constructor(config: EmailNotifierConfig) {
    this.config = config; // Store config

    this.baseLogger = loggerFactory.createLogger({
      component: "EmailNotifier",
    });
    this.baseLogger.info(
      { host: config.host, port: config.port, user: config.auth.user },
      "Initializing..."
    );

    try {
      this.transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.auth,
        pool: true,
        maxConnections: 5,
      });
    } catch (err) {
      let errorMessage = "An unknown error occurred";
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === "string") {
        errorMessage = err;
      }
      throw new Error(
        `Failed to create Nodemailer transporter: ${errorMessage}`
      );
    }

    const maxEmailsPerSecond = config.maxEmailsPerSecond || 10;
    this.rateLimiter = new RateLimiter(maxEmailsPerSecond, 1000);
  }

  /**
   * Sends emails using the batchSender utility.
   */
  async send(
    emails: string[],
    meta: EmailMeta[],
    logger: PinoLogger
  ): Promise<NotificationResult[]> {
    // Delegate the batching, concurrency, rate limiting, and error aggregation
    return batchSender.process(
      emails,
      meta,
      this.rateLimiter,
      this._sendSingleEmail.bind(this),
      logger,
      { concurrency: 3 }
    );
  }

  /**
   * Sends a single email. Called by batchSender.
   * @param email Recipient email address.
   * @param emailMeta Metadata for this specific email.
   * @param taskLogger Logger instance with context for this specific task.
   * @returns A NotificationResult object.
   */
  private async _sendSingleEmail(
    email: string,
    emailMeta: EmailMeta,
    taskLogger: PinoLogger
  ): Promise<NotificationResult> {
    if (!emailMeta || !emailMeta.subject) {
      taskLogger.warn("Missing subject in email meta.");
      return { status: "error", recipient: email, error: "MISSING_SUBJECT" };
    }

    try {
      const emailOptions: Mail.Options = {
        from: this.config.from,
        to: email,
        subject: emailMeta.subject,
        ...(emailMeta.html
          ? { html: emailMeta.html }
          : { text: emailMeta.text || "" }),
        ...(emailMeta.attachments
          ? { attachments: emailMeta.attachments }
          : {}),
      };

      taskLogger.trace(
        { options: { subject: emailOptions.subject } },
        "Sending email via transporter..."
      );
      const info = await this.transporter.sendMail(emailOptions);
      taskLogger.debug(
        { messageId: info.messageId, accepted: info.accepted?.length },
        "Email sent successfully."
      );

      // Return SUCCESS result
      return {
        status: "success",
        recipient: email,
        response: {
          messageId: info.messageId,
          accepted: info.accepted,
          rejected: info.rejected,
        },
      };
    } catch (err) {
      let errorMessage = "Unknown email send error";
      let statusCode: string | number = "N/A";
      let nodeCode: string | undefined;

      if (err instanceof Error) {
        errorMessage = err.message;
        nodeCode = (err as any).code;
        statusCode = (err as any).responseCode || "N/A";
      }
      taskLogger.warn(
        { err, errorCode: nodeCode || statusCode },
        `Failed sending email.`
      );

      // Sanitize the full original error message slightly
      const sanitizedMessage = errorMessage
        .replace(/\s+/g, "_")
        .replace(/[.:;,*+?^${}()|[\]\\]/g, "");

      // Construct the key BODY: <StatusCodeOrNodeCode>:<SanitizedFullErrorMessage>
      // Prioritize SMTP status code if available, otherwise Node code
      const primaryCode = statusCode !== "N/A" ? statusCode : nodeCode || "N/A";
      const errorKeyBody = `${primaryCode}:${sanitizedMessage}`;

      // Return ERROR result
      return {
        status: "error",
        recipient: email,
        error: errorKeyBody.substring(0, 255),
        response: {
          message: errorMessage,
          code: nodeCode,
          statusCode: statusCode,
        },
      };
    }
  }

  async close(logger: PinoLogger): Promise<void> {
    if (this.transporter && this.transporter.close) {
      logger.info("Closing Nodemailer transporter connections...");
      this.transporter.close();
    }
  }
}
