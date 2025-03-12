// src/db/BatchProcessor.ts
import { RateLimiter } from "./RateLimiter";

export interface BatchQueryOptions {
  batchSize?: number;
  maxQueriesPerSecond?: number;
}

/**
 * Processes database records in batches.
 * Instead of relying on a pre-known total, this function keeps querying using the provided
 * processBatch function (which takes offset and limit) until an empty array is returned.
 *
 * @param processBatch - A function that queries the database given an offset and a limit, and returns a Promise of an array of records.
 * @param handler - A function that processes the batch of records.
 * @param options - Optional pagination and rate limiting options.
 */
export async function processInBatches<T>(
  processBatch: (offset: number, limit: number) => Promise<T[]>,
  handler: (items: T[]) => Promise<void>,
  options?: BatchQueryOptions
): Promise<void> {
  const batchSize = options?.batchSize ?? 1000;
  const rateLimiter = new RateLimiter(options?.maxQueriesPerSecond ?? 10, 1000);
  let offset = 0;

  while (true) {
    // Use the rate limiter to schedule each batch query.
    const items = await rateLimiter.schedule(() =>
      processBatch(offset, batchSize)
    );
    if (!items || items.length === 0) {
      // If no more records, break the loop.
      break;
    }

    // Process the current batch.
    await handler(items);

    // Increase the offset by the number of items returned.
    offset += items.length;
  }
}
