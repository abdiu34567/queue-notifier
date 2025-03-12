import nodemailer, { Transporter } from "nodemailer";
import { NotificationChannel } from "./NotificationChannel";
import { RateLimiter } from "../../core/RateLimiter";

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
    meta?: Record<string, any>
  ): Promise<void> {
    const sendPromises = userIds.map((email) =>
      this.rateLimiter.schedule(() =>
        this.transporter
          .sendMail({
            from: this.config.from,
            to: email,
            subject: meta?.subject || "Notification",
            text: message,
            html: meta?.html || message, // allow html emails optionally
          })
          .then((info) => {
            console.log(`📨 Email sent to ${userIds}: ${info.messageId}`);
          })
          .catch((err) => {
            console.error(`❌ Email Error (Recipient ${userIds}):`, err);
          })
      )
    );

    await Promise.all(sendPromises);
  }
}
