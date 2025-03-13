import nodemailer, { Transporter } from "nodemailer";
import { NotificationChannel } from "./NotificationChannel";
import { RateLimiter } from "../../core/RateLimiter";
import Logger from "../../utils/Logger";

interface EmailNotifierConfig {
  host: string;
  port: number;
  secure: boolean; // true for 465, false for other ports
  auth: {
    user: string;
    pass: string;
  };
  from: string; // default sender address
  maxEmailsPerSecond?: number; // optional rate limit
}

export class EmailNotifier implements NotificationChannel {
  private transporter: Transporter;
  private rateLimiter: RateLimiter;

  constructor(private config: EmailNotifierConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
    });

    this.rateLimiter = new RateLimiter(config.maxEmailsPerSecond || 10, 1000); // default 10 emails/sec
  }

  async send(
    userIds: string[],
    message: string,
    meta?: Record<string, any> | undefined
  ): Promise<
    { status: string; recipient: string; response?: any; error?: string }[]
  > {
    const results: any[] = [];

    await Promise.all(
      userIds.map(async (email) => {
        try {
          const info = await this.rateLimiter.schedule(() =>
            this.transporter.sendMail({
              from: this.config.from,
              to: email,
              subject: meta?.subject || "Notification",
              text: message,
              html: meta?.html || message, // Allow optional HTML emails
            })
          );

          Logger.log(`📨 Email sent to ${email}: ${info.messageId}`);

          results.push({ status: "success", recipient: email, response: info });
        } catch (err: any) {
          Logger.error(`❌ Email Error (Recipient ${email}):`, err.message);
          results.push({
            status: "failed",
            recipient: email,
            error: err.message,
          });
        }
      })
    );

    return results;
  }
}
