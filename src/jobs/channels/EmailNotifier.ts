import nodemailer, { Transporter } from "nodemailer";
import { RateLimiter } from "../../core/RateLimiter";
import Logger from "../../utils/Logger";
import { MailOptions, NotificationChannel } from "./NotificationChannel";
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
    const results: {
      status: string;
      recipient: string;
      response?: any;
      error?: string;
    }[] = [];
    const maxConcurrentEmails = 3; // Limits concurrent email sending
    const tasks: Promise<void>[] = [];

    for (let i = 0; i < users.length; i++) {
      const email = users[i];
      const emailMeta = meta[i] || {};

      const sendTask = this.rateLimiter.schedule(async () => {
        try {
          const emailOptions: Mail.Options = {
            from: this.config.from,
            to: email,
            subject: emailMeta.subject || "No Subject",
            text: emailMeta.text || "",
            html: emailMeta.html || "",
            ...(emailMeta.attachments
              ? { attachments: emailMeta.attachments }
              : {}),
          };

          const info = await this.transporter.sendMail(emailOptions);

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
      });

      tasks.push(sendTask);

      // When we've reached our concurrency limit, wait for the batch to finish
      if (tasks.length === maxConcurrentEmails) {
        await Promise.all(tasks);
        tasks.length = 0; // Clear the tasks array for the next batch
      }
    }

    // Await any remaining tasks that didn't form a full batch
    if (tasks.length > 0) {
      await Promise.all(tasks);
    }

    return results;
  }
}
