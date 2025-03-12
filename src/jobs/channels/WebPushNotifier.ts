import webPush, { PushSubscription } from "web-push";
import { NotificationChannel } from "./NotificationChannel";
import { RateLimiter } from "../../core/RateLimiter";

interface WebPushNotifierConfig {
  publicKey: string;
  privateKey: string;
  contactEmail: string;
  maxMessagesPerSecond?: number;
}

export class WebPushNotifier implements NotificationChannel {
  private rateLimiter: RateLimiter;

  constructor(private config: WebPushNotifierConfig) {
    webPush.setVapidDetails(
      "mailto:" + this.config.contactEmail,
      this.config.publicKey,
      this.config.privateKey
    );

    this.rateLimiter = new RateLimiter(config.maxMessagesPerSecond || 50, 1000); // Default ~50/sec
  }

  async send(
    userIds: string[],
    message: string,
    meta?: Record<string, any>
  ): Promise<void> {
    const subscriptions: PushSubscription[] = userIds.map((id) =>
      JSON.parse(id)
    );

    const sendPromises = subscriptions.map((subscription) =>
      this.rateLimiter.schedule(() =>
        webPush
          .sendNotification(
            subscription,
            JSON.stringify({
              title: meta?.title || "Notification",
              body: message,
              data: meta?.data || {},
            })
          )
          .then(() => {
            console.log(`📨 Web Push sent successfully.`);
          })
          .catch((err) => {
            console.error("❌ Web Push Error:", err);
          })
      )
    );

    await Promise.all(sendPromises);
  }
}

interface WebPushNotifierConfig {
  publicKey: string;
  privateKey: string;
  contactEmail: string; // Required by Web Push spec
  maxMessagesPerSecond?: number;
}
