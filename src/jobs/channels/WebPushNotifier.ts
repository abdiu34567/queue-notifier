import webPush, { PushSubscription } from "web-push";
import { NotificationChannel } from "./NotificationChannel";
import { RateLimiter } from "../../core/RateLimiter";
import Logger from "../../utils/Logger";

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
  ): Promise<
    { status: string; recipient: string; response?: any; error?: string }[]
  > {
    const subscriptions: PushSubscription[] = userIds.map((id) =>
      JSON.parse(id)
    );
    const results: any[] = [];

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          const response = await this.rateLimiter.schedule(() =>
            webPush.sendNotification(
              subscription,
              JSON.stringify({
                title: meta?.title || "Notification",
                body: message,
                data: meta?.data || {},
              })
            )
          );

          Logger.log(
            `📨 Web Push sent successfully to ${subscription.endpoint}`
          );
          results.push({
            status: "success",
            recipient: subscription.endpoint,
            response,
          });
        } catch (error: any) {
          Logger.error(
            `❌ Web Push Error (Recipient ${subscription.endpoint}):`,
            error.message
          );
          results.push({
            status: "failed",
            recipient: subscription.endpoint,
            error: error.message,
          });
        }
      })
    );

    return results;
  }
}
