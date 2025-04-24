import { RateLimiter } from "./RateLimiter";
import { NotificationResult } from "../jobs/channels/NotificationChannel";
import { Logger as PinoLogger } from "pino";

type SendSingleFunction<RecipientType, MetaType> = (
  recipient: RecipientType,
  meta: MetaType,
  taskLogger: PinoLogger
) => Promise<NotificationResult>;

interface BatchSenderOptions {
  concurrency?: number;
}

export const batchSender = {
  /**
   * Processes recipients in batches, handling concurrency, rate limiting, and error catching.
   * @param recipients Array of recipients (e.g., emails, tokens).
   * @param meta Array of corresponding metadata objects.
   * @param rateLimiter The RateLimiter instance to use.
   * @param sendSingle The async function that sends one notification and returns a NotificationResult.
   * @param logger The base logger instance for the overall batch operation.
   * @param options Batch processing options (e.g., concurrency).
   * @returns Promise resolving to an array of NotificationResult objects.
   */
  async process<RecipientType, MetaType>(
    recipients: RecipientType[],
    meta: MetaType[],
    rateLimiter: RateLimiter,
    sendSingle: SendSingleFunction<RecipientType, MetaType>,
    logger: PinoLogger,
    options?: BatchSenderOptions
  ): Promise<NotificationResult[]> {
    const concurrency = options?.concurrency ?? 5; // Default concurrency
    const results: NotificationResult[] = []; // Array to hold all final results
    const tasks: Promise<void>[] = [];
    let successCount = 0;
    let failureCount = 0;
    let skippedCount = 0; // Count items skipped before attempting send

    logger.info(
      { recipientCount: recipients.length, concurrency },
      "Starting batch processing via BatchSender."
    );

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      const userMeta = meta?.[i];
      const taskLogger = logger.child({
        recipient: String(recipient)?.slice(-10),
        index: i,
      });

      if (!recipient) {
        taskLogger.warn(
          { validationRule: "missingOrEmptyRecipient" },
          "Skipping invalid recipient (missing or empty)."
        );
        // Pre-populate result for skipped item
        results[i] = {
          status: "error",
          recipient: `invalid_recipient_at_index_${i}`,
          error: "Invalid recipient data",
        };
        skippedCount++;
        continue;
      }
      if (!userMeta) {
        taskLogger.warn(
          { validationRule: "missingMeta" },
          "Skipping recipient due to missing meta."
        );
        results[i] = {
          status: "error",
          recipient: String(recipient),
          error: "Missing meta for recipient",
        };
        skippedCount++;
        continue;
      }
      // Update logger context now that we have a valid recipient string
      taskLogger.setBindings({ recipient: String(recipient).slice(-10) });

      const currentIndex = i; // Capture index

      // Schedule the execution of sendSingle
      const task = rateLimiter.schedule(async () => {
        taskLogger.trace("Executing sendSingle via rate limiter.");
        let result: NotificationResult | null = null;
        try {
          // Call the provided function to send one item
          result = await sendSingle(recipient, userMeta, taskLogger);
        } catch (error) {
          // Catch unexpected errors thrown by sendSingle itself
          let errorMessage = "Unknown error during sendSingle execution";
          if (error instanceof Error) errorMessage = error.message;
          taskLogger.error(
            { err: error },
            "Unexpected error executing sendSingle function."
          );
          // Create a generic error result if sendSingle failed unexpectedly
          result = {
            status: "error",
            recipient: String(recipient),
            error: "INTERNAL_SEND_ERROR",
            response: errorMessage,
          };
        }

        // Store the result (success or error) from sendSingle
        if (result) {
          results[currentIndex] = result; // Place result in correct index
          if (result.status === "success") {
            successCount++;
          } else {
            failureCount++;
          }
        } else {
          // Should not happen if sendSingle always returns a result, but handle defensively
          results[currentIndex] = {
            status: "error",
            recipient: String(recipient),
            error: "UNKNOWN_PROCESSING_FAILURE",
          };
          failureCount++;
        }
      }); // End rate limiter schedule

      tasks.push(task);

      // Handle concurrency
      if (tasks.length >= concurrency) {
        logger.trace(
          { taskCount: tasks.length },
          `Concurrency limit reached, awaiting batch...`
        );
        try {
          await Promise.all(tasks);
        } catch (e) {
          logger.error({ err: e }, "Error during concurrent batch wait.");
        }
        tasks.length = 0; // Reset
      }
    }
    // Await remaining tasks
    if (tasks.length > 0) {
      logger.trace(
        { taskCount: tasks.length },
        `Awaiting final ${tasks.length} task(s)...`
      );
      try {
        await Promise.all(tasks);
      } catch (e) {
        logger.error({ err: e }, "Error during final batch wait.");
      }
    }

    // Ensure the results array is correctly sized and filled
    const finalResults = recipients.map(
      (_, idx) =>
        results[idx] || {
          status: "error",
          recipient: String(recipients[idx] || `unknown_at_index_${idx}`),
          error: "PROCESSING_ERROR_OR_SKIPPED", // Indicates issue before or during async task
        }
    );

    logger.info(
      {
        successCount,
        failureCount,
        skippedCount,
        totalAttempted: recipients.length,
      },
      "Finished batch processing via BatchSender."
    );
    return finalResults;
  },
};
