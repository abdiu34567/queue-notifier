import nodemailer, { Transporter } from "nodemailer";
import { RateLimiter } from "../../core/RateLimiter";
import Logger from "../../utils/Logger";
import {
  MailOptions,
  MailOptions1,
  NotificationChannel,
} from "./NotificationChannel";
import Mail from "nodemailer/lib/mailer";

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
    users: string[],
    meta: MailOptions[]
  ): Promise<
    { status: string; recipient: string; response?: any; error?: string }[]
  > {
    const results: any[] = [];

    await Promise.all(
      users.map(async (email, index) => {
        try {
          const emailOptions: Partial<MailOptions & MailOptions1> =
            meta[index] || {};
          delete emailOptions.to;
          delete emailOptions.from;

          const info = await this.rateLimiter.schedule(() =>
            this.transporter.sendMail({
              from: this.config.from,
              to: email,
              ...(emailOptions as Mail.Options),
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
