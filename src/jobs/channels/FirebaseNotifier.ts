import admin, { ServiceAccount } from "firebase-admin";
import {
  FirebaseNotificationOptions,
  NotificationChannel,
} from "./NotificationChannel";
import { RateLimiter } from "../../core/RateLimiter";
import Logger from "../../utils/Logger";

interface FirebaseNotifierConfig {
  serviceAccount: ServiceAccount;
  maxMessagesPerSecond?: number;
}

export class FirebaseNotifier implements NotificationChannel {
  private static initialized = false;
  private rateLimiter: RateLimiter;

  constructor(private config: FirebaseNotifierConfig) {
    this.initFirebase();
    this.rateLimiter = new RateLimiter(
      config.maxMessagesPerSecond || 500, // Default to 500 messages per second
      1000
    );
  }

  private initFirebase() {
    if (!FirebaseNotifier.initialized) {
      if (admin.apps.length === 0) {
        admin.initializeApp({
          credential: admin.credential.cert(this.config.serviceAccount),
        });
        Logger.log("✅ Firebase initialized successfully.");
      }
      FirebaseNotifier.initialized = true;
    }
  }

  async send(
    userIds: string[],
    meta?: FirebaseNotificationOptions[]
  ): Promise<
    { status: string; recipient: string; response?: any; error?: string }[]
  > {
    const messaging = admin.messaging();
    const results: any[] = [];

    for (let i = 0; i < userIds.length; i++) {
      const userId = userIds[i];
      const userMeta = meta?.[i] || {};

      await this.rateLimiter.schedule(async () => {
        try {
          const response = await messaging.send({
            token: userId,
            notification: {
              title: userMeta.title || "Default Notification",
              body: userMeta.body || "",
            },
            ...(userMeta.data ? { data: userMeta.data } : {}), // Only include `data` if present
          });

          Logger.log(`📨 Firebase notification sent to ${userId}`);
          results.push({
            status: "success",
            recipient: userId,
            response,
          });
        } catch (error: any) {
          Logger.error(
            `❌ Firebase Error (Token: ${userId}): ${error.message}`
          );
          results.push({
            status: "failed",
            recipient: userId,
            error: error.message,
          });
        }
      });
    }

    return results;
  }

  // Utility function for chunking tokens
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    return Array.from({ length: Math.ceil(array.length / chunkSize) }, (_, i) =>
      array.slice(i * chunkSize, i * chunkSize + chunkSize)
    );
  }
}
