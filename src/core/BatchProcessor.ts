import { Logger as PinoLogger } from "pino";

export interface BatchQueryOptions {
  batchSize?: number;
}

export async function processInBatches<T>(
  processBatch: (offset: number, limit: number) => Promise<T[]>,
  handler: (items: T[]) => Promise<void>,
  logger: PinoLogger, // <-- Add logger parameter
  options?: BatchQueryOptions
): Promise<void> {
  const batchSize = options?.batchSize ?? 1000;
  // Consider making concurrency configurable?
  const maxConcurrentBatches = 3;

  logger.info(
    { batchSize, maxConcurrentBatches },
    "Starting batch processing."
  );

  let offset = 0;
  let totalItemsProcessed = 0;
  let batchCounter = 0;
  let activeBatches: Promise<void>[] = [];
  let processingComplete = false; // Flag to prevent infinite loop on error

  while (!processingComplete) {
    let items: T[];
    try {
      logger.trace(
        { offset, batchSize, batchNum: batchCounter + 1 },
        "Fetching next batch."
      );
      items = await processBatch(offset, batchSize); // Errors here will propagate up
    } catch (fetchError) {
      logger.error(
        { err: fetchError, offset, batchSize },
        "Error fetching batch from processBatch."
      );
      throw fetchError;
    }

    if (!items || items.length === 0) {
      logger.debug(
        { offset, batchSize },
        "Received empty batch, signalling end of data."
      );
      processingComplete = true; // Set flag to exit loop
      break; // Exit the while loop
    }

    batchCounter++;
    const currentBatchNum = batchCounter;
    const itemCount = items.length;
    totalItemsProcessed += itemCount;
    logger.debug(
      { itemCount, batchNum: currentBatchNum, offset },
      `Processing batch ${currentBatchNum}.`
    );

    // Create task for the handler
    const batchTask = handler(items)
      .then(() => {
        logger.trace(
          { batchNum: currentBatchNum },
          `Handler finished for batch ${currentBatchNum}.`
        );
      })
      .catch((handlerError) => {
        logger.error(
          { err: handlerError, batchNum: currentBatchNum },
          `Error processing batch ${currentBatchNum} in handler.`
        );
        throw handlerError;
      });

    activeBatches.push(batchTask);

    // If we've reached our concurrency limit, wait for ONE to finish to make room
    if (activeBatches.length >= maxConcurrentBatches) {
      logger.trace(
        { activeCount: activeBatches.length },
        `Concurrency limit reached, waiting for batches to complete...`
      );
      try {
        await Promise.all(activeBatches); // Wait for the current concurrent set
      } catch (error) {
        logger.error(
          { err: error },
          `Error occurred while waiting for concurrent batch handlers. Stopping.`
        );
        // Stop processing if any handler in the concurrent set failed
        processingComplete = true;
        break; // Exit the while loop
      }
      logger.trace("Concurrency slot freed.");
      activeBatches = []; // Reset the list for the next set
    }

    offset += itemCount; // Only increment offset AFTER successful fetch
  } // End while loop

  // Wait for any remaining batches outside the main concurrency loop
  if (activeBatches.length > 0) {
    logger.debug(
      { remainingCount: activeBatches.length },
      `Waiting for ${activeBatches.length} final batch(es) to complete...`
    );
    try {
      await Promise.all(activeBatches);
    } catch (finalError) {
      logger.error(
        { err: finalError },
        `Error occurred while waiting for final batch handlers.`
      );
      throw finalError;
    }
  }

  logger.info(
    { totalItemsProcessed, batchCount: batchCounter },
    "Batch processing finished."
  );
}

/**
 * Retries an async operation with exponential backoff.
 *
 * @param operation - The async function to execute.
 * @param logger - The Pino logger instance for logging retries/errors.
 * @param operationName - Optional descriptive name of the operation for logs.
 * @param maxRetries - Maximum number of retry attempts.
 * @param baseDelay - Initial delay in milliseconds for backoff.
 * @returns The result of the operation if successful.
 * @throws The error from the operation if all retries fail.
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  logger: PinoLogger,
  operationName: string = "Unnamed Operation",
  maxRetries: number = 5,
  baseDelay: number = 500
): Promise<T> {
  let attempt = 0;

  // Add trace log for initial attempt
  logger.trace(
    { attempt: attempt + 1, maxRetries, operationName },
    `Attempting operation.`
  );

  while (attempt <= maxRetries) {
    try {
      const result = await operation();
      if (attempt > 0) {
        logger.debug(
          { attempt: attempt + 1, operationName },
          `Operation succeeded after retry.`
        );
      }
      return result;
    } catch (error: any) {
      const isLastError = attempt === maxRetries;
      const logContext = {
        err: error, // Pass the actual error object
        attempt: attempt + 1,
        maxRetries,
        operationName,
      };

      if (isLastError) {
        // Use logger.error for the final failure
        logger.error(logContext, `Max retries reached. Operation failed.`);
        throw error; // Fails after max retries
      }

      const delay = baseDelay * Math.pow(2, attempt);
      logger.warn(
        { ...logContext, delay },
        `Operation failed. Retrying after ${delay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt++;
    }
  }

  const finalError = new Error(
    `${operationName} failed after ${maxRetries + 1} attempts.`
  );
  logger.error({ operationName, maxRetries }, finalError.message);
  throw finalError;
}
