import admin, { ServiceAccount } from "firebase-admin";
import { NotificationChannel } from "./NotificationChannel";
import { RateLimiter } from "../../core/RateLimiter";

interface FirebaseNotifierConfig {
  serviceAccount: ServiceAccount;
  maxMessagesPerSecond?: number; // Allow users to configure
}

export class FirebaseNotifier implements NotificationChannel {
  private initialized = false;
  private rateLimiter: RateLimiter;

  constructor(private config: FirebaseNotifierConfig) {
    this.initFirebase();
    // Default to high limit if not specified explicitly
    this.rateLimiter = new RateLimiter(
      config.maxMessagesPerSecond || 500,
      1000
    );
  }

  private initFirebase() {
    if (!this.initialized) {
      admin.initializeApp({
        credential: admin.credential.cert(this.config.serviceAccount),
      });
      this.initialized = true;
    }
  }

  async send(
    userIds: string[],
    message: string,
    meta?: Record<string, any>
  ): Promise<void> {
    const messaging = admin.messaging();

    const payload: admin.messaging.MessagingPayload = {
      notification: {
        title: meta?.title || "Notification",
        body: message,
      },
      data: meta?.data || {},
    };

    const tokensChunks = this.chunkArray(userIds, 500); // FCM limit: max 500 tokens per request

    for (const tokens of tokensChunks) {
      await this.rateLimiter.schedule(async () => {
        try {
          const response = await messaging.sendEachForMulticast({
            tokens,
            ...payload,
          });

          console.log(
            `📨 Firebase notifications sent: ${response.successCount} succeeded, ${response.failureCount} failed.`
          );

          if (response.failureCount > 0) {
            response.responses.forEach((res, idx) => {
              if (!res.success) {
                console.error(
                  `❌ Firebase Error (Token: ${tokens[idx]}):`,
                  res.error
                );
              }
            });
          }
        } catch (error) {
          console.error("❌ Firebase Notification Error:", error);
        }
      });
    }
  }

  // Utility function for chunking tokens
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}
