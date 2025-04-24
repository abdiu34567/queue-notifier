import admin from "firebase-admin";
import { ServiceAccount } from "firebase-admin/app";
import { loggerFactory } from "../../utils/LoggerFactory";
import { Logger as PinoLogger } from "pino";
import {
  FirebaseMeta,
  NotificationChannel,
  NotificationResult,
} from "./NotificationChannel";
import { RateLimiter } from "../../core/RateLimiter";
import { batchSender } from "../../core/BatchSender";

interface FirebaseNotifierOptionalConfig {
  maxMessagesPerSecond?: number;
}

export class FirebaseNotifier implements NotificationChannel {
  // Static flag to prevent multiple initializations in the same process
  private static initialized = false;
  private rateLimiter: RateLimiter;
  private credentialInfo: ServiceAccount | string;
  private app: admin.app.App | undefined;
  private baseLogger: PinoLogger;

  /**
   * Creates an instance of FirebaseNotifier.
   * Initializes Firebase Admin SDK (if needed) and sets up rate limiting.
   *
   * @param {ServiceAccount | string} credentialInfo - The ServiceAccount credential object or a path to the service account JSON file.
   * @param {FirebaseNotifierOptionalConfig} [config] - Optional configuration like rate limits.
   */
  constructor(
    credentialInfo: ServiceAccount | string,
    config?: FirebaseNotifierOptionalConfig
  ) {
    this.baseLogger = loggerFactory.createLogger({
      component: "FirebaseNotifier",
    });
    this.baseLogger.info("Initializing...");

    this.credentialInfo = credentialInfo;
    // Initialize Firebase Admin SDK using the base logger
    this.initFirebase(this.baseLogger);

    // Configure rate limiter
    const maxMessagesPerSecond = config?.maxMessagesPerSecond || 500; // Default 500 qps
    this.rateLimiter = new RateLimiter(maxMessagesPerSecond, 1000);
    this.baseLogger.info(
      { rateLimit: maxMessagesPerSecond },
      "Rate limiter configured."
    );
  }

  /**
   * Initializes the Firebase Admin SDK, ensuring it only happens once per process.
   * Uses the provided logger for output.
   * @param logger - The PinoLogger instance to use for logging init steps.
   */
  private initFirebase(logger: PinoLogger): void {
    if (FirebaseNotifier.initialized) {
      // If globally initialized but this instance doesn't have the app ref yet
      if (!this.app) {
        logger.debug(
          "Attaching to already initialized Firebase Admin SDK instance."
        );
        this.app = admin.app(); // Get default app instance
      } else {
        logger.trace(
          "Firebase already initialized, app instance already attached."
        );
      }
      return; // Already initialized, nothing more to do
    }

    logger.debug("Performing Firebase Admin SDK initialization check.");
    if (admin.apps.length > 0) {
      // Another part of the application already initialized it
      this.app = admin.app();
      logger.info(
        "Using existing Firebase Admin SDK instance (initialized externally)."
      );
      FirebaseNotifier.initialized = true; // Mark as initialized globally
      return;
    }

    // Proceed with initialization
    let credential;
    const credentialType =
      typeof this.credentialInfo === "string" ? "path" : "object";
    logger.debug({ credentialType }, "Attempting to load credentials...");

    try {
      if (typeof this.credentialInfo === "string") {
        credential = admin.credential.cert(this.credentialInfo);
        logger.debug("Credentials loaded from path.");
      } else if (
        typeof this.credentialInfo === "object" &&
        this.credentialInfo !== null
      ) {
        if (
          !this.credentialInfo.projectId ||
          !this.credentialInfo.privateKey ||
          !this.credentialInfo.clientEmail
        ) {
          throw new Error(
            "ServiceAccount object is missing required properties (projectId, privateKey, clientEmail)."
          );
        }
        credential = admin.credential.cert(this.credentialInfo);
        logger.debug("Credentials loaded from object.");
      } else {
        throw new Error("Invalid Firebase credential format.");
      }
    } catch (e) {
      let errorMessage = "An unknown credential error occurred";
      if (e instanceof Error) errorMessage = e.message;
      logger.error(
        { err: e, credentialType },
        `Failed to load Firebase credentials.`
      );
      throw new Error(
        `Invalid Firebase credential configuration: ${errorMessage}`
      );
    }

    try {
      logger.debug("Initializing Firebase Admin SDK app...");
      this.app = admin.initializeApp({ credential });
      logger.info("Firebase Admin SDK initialized successfully.");
      FirebaseNotifier.initialized = true; // Mark as initialized globally
    } catch (initError) {
      let errorMessage = "An unknown initialization error occurred";
      if (initError instanceof Error) errorMessage = initError.message;
      logger.error(
        { err: initError },
        "Failed to initialize Firebase Admin SDK."
      );
      throw new Error(
        `Firebase Admin SDK initialization failed: ${errorMessage}`
      );
    }
  }

  /**
   * Sends Firebase messages using the batchSender utility.
   */
  async send(
    tokens: string[],
    meta: FirebaseMeta[] | any[],
    logger: PinoLogger
  ): Promise<NotificationResult[]> {
    if (!this.app) {
      logger.error("Firebase SDK App instance is not available. Cannot send.");
      return tokens.map((token) => ({
        status: "error",
        recipient: token,
        error: "Firebase SDK not initialized properly",
      }));
    }

    // Delegate processing to batchSender
    return batchSender.process(
      tokens,
      meta,
      this.rateLimiter,
      this._sendSingleFCM.bind(this),
      logger,
      { concurrency: 5 }
    );
  }

  /**
   * Sends a single FCM message. Called by batchSender.
   * @param token The FCM registration token.
   * @param userMeta Metadata for this specific message.
   * @param taskLogger Logger instance with context for this specific task.
   * @returns A NotificationResult object.
   */
  private async _sendSingleFCM(
    token: string,
    userMeta: FirebaseMeta,
    taskLogger: PinoLogger
  ): Promise<NotificationResult> {
    if (!this.app) {
      taskLogger.error("Firebase app instance missing in _sendSingleFCM.");
      return { status: "error", recipient: token, error: "INTERNAL_SDK_ERROR" };
    }
    const messaging = this.app.messaging();

    try {
      if (!userMeta || typeof userMeta !== "object") {
        taskLogger.warn("Invalid meta object provided for single send.");
        return {
          status: "error",
          recipient: token,
          error: "Invalid meta for recipient",
        };
      }

      const messageToSend: admin.messaging.Message = {
        token: token,
        ...(userMeta.notification
          ? { notification: userMeta.notification }
          : {
              notification: { title: userMeta.title, body: userMeta.body },
            }),
        ...(userMeta.android ? { android: userMeta.android } : {}),
        ...(userMeta.apns ? { apns: userMeta.apns } : {}),
        ...(userMeta.webpush ? { webpush: userMeta.webpush } : {}),
        ...(userMeta.fcmOptions ? { fcmOptions: userMeta.fcmOptions } : {}),
        ...(userMeta.data ? { data: userMeta.data } : {}),
      };

      if (
        messageToSend.notification &&
        !messageToSend.notification.title &&
        !messageToSend.notification.body
      ) {
        taskLogger.trace("Removing empty notification object from payload.");
        delete messageToSend.notification;
      }
      if (
        !messageToSend.notification &&
        (!messageToSend.data || Object.keys(messageToSend.data).length === 0)
      ) {
        taskLogger.error(
          "Cannot send message without notification or data payload."
        );
        // Return error result instead of throwing from here
        return {
          status: "error",
          recipient: token,
          error: "INVALID_PAYLOAD",
          response: "Message must contain notification or data",
        };
      }

      taskLogger.trace("Sending message via FCM...");
      const response = await messaging.send(messageToSend); // The actual API call
      taskLogger.debug(
        { messageId: response },
        "Firebase message sent successfully."
      );

      // Return SUCCESS result
      return {
        status: "success",
        recipient: token,
        response: response, // FCM message ID
      };
    } catch (error) {
      let errorMessage = "Unknown FCM send error";
      let firebaseCode = "UNKNOWN_FCM_ERROR";
      let statusCode: string | number = "N/A";

      if (error instanceof Error) {
        errorMessage = error.message;
        if ((error as any).code && typeof (error as any).code === "string") {
          firebaseCode = (error as any).code;
        }
      }
      taskLogger.warn(
        { err: error, firebaseCode },
        `Firebase send error for token.`
      );

      // Sanitize the full original error message slightly
      const sanitizedMessage = errorMessage
        .replace(/\s+/g, "_")
        .replace(/[.:;,*+?^${}()|[\]\\]/g, "");

      // Construct the key BODY: <StatusCode>:<SanitizedFullErrorMessage>
      // Since FCM errors here don't usually have a direct HTTP status, use N/A
      const errorKeyBody = `${statusCode}:${firebaseCode}:${sanitizedMessage}`; // Include code AND message

      return {
        status: "error",
        recipient: token,
        error: errorKeyBody.substring(0, 255),
        response: {
          message: errorMessage,
          code: firebaseCode,
        },
      };
    }
  }
}
