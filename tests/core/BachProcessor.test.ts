import { processInBatches } from "../../src/core/BatchProcessor";
import {
  createMockLogger,
  mockLoggerFn,
  clearMockLogger,
} from "../__mocks__/pino";

interface TestItem {
  id: number;
}

describe("processInBatches", () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockProcessBatch: jest.Mock<Promise<TestItem[]>>;
  let mockHandler: jest.Mock<Promise<void>>;

  beforeEach(() => {
    mockLogger = createMockLogger("info");
    clearMockLogger();
    mockProcessBatch = jest.fn();
    mockHandler = jest.fn().mockResolvedValue(undefined);
  });

  test("should process all items in multiple batches", async () => {
    mockProcessBatch
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
      .mockResolvedValueOnce([{ id: 3 }, { id: 4 }])
      .mockResolvedValueOnce([{ id: 5 }])
      .mockResolvedValueOnce([]);

    await processInBatches(mockProcessBatch, mockHandler, mockLogger, {
      batchSize: 2,
    });

    // Check processBatch calls
    expect(mockProcessBatch).toHaveBeenCalledTimes(4);
    expect(mockProcessBatch).toHaveBeenNthCalledWith(1, 0, 2);
    expect(mockProcessBatch).toHaveBeenNthCalledWith(2, 2, 2);
    expect(mockProcessBatch).toHaveBeenNthCalledWith(3, 4, 2);
    expect(mockProcessBatch).toHaveBeenNthCalledWith(4, 5, 2);

    // Check handler calls
    expect(mockHandler).toHaveBeenCalledTimes(3);
    expect(mockHandler).toHaveBeenNthCalledWith(1, [{ id: 1 }, { id: 2 }]);
    expect(mockHandler).toHaveBeenNthCalledWith(2, [{ id: 3 }, { id: 4 }]);
    expect(mockHandler).toHaveBeenNthCalledWith(3, [{ id: 5 }]);

    // Check final log
    expect(mockLoggerFn).toHaveBeenCalledWith(
      expect.objectContaining({ totalItemsProcessed: 5, batchCount: 3 }),
      "Batch processing finished."
    );
  });

  test("should handle empty initial fetch", async () => {
    mockProcessBatch.mockResolvedValueOnce([]);

    await processInBatches(mockProcessBatch, mockHandler, mockLogger, {
      batchSize: 10,
    });

    expect(mockProcessBatch).toHaveBeenCalledTimes(1);
    expect(mockProcessBatch).toHaveBeenCalledWith(0, 10);
    expect(mockHandler).not.toHaveBeenCalled();
    expect(mockLoggerFn).toHaveBeenCalledWith(
      expect.objectContaining({ totalItemsProcessed: 0, batchCount: 0 }),
      "Batch processing finished."
    );
    expect(mockLoggerFn).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0, batchSize: 10 }),
      expect.stringContaining("Received empty batch, signalling end of data.")
    );
  });

  test("should respect batchSize option", async () => {
    mockProcessBatch
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }])
      .mockResolvedValueOnce([]);

    await processInBatches(mockProcessBatch, mockHandler, mockLogger, {
      batchSize: 3,
    });

    expect(mockProcessBatch).toHaveBeenCalledTimes(2);
    expect(mockProcessBatch).toHaveBeenCalledWith(0, 3);
    expect(mockHandler).toHaveBeenCalledTimes(1);
    expect(mockHandler).toHaveBeenCalledWith([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(mockLoggerFn).toHaveBeenCalledWith(
      expect.objectContaining({ totalItemsProcessed: 3, batchCount: 1 }),
      "Batch processing finished."
    );
  });

  test("should stop processing if processBatch throws error", async () => {
    const fetchError = new Error("Database connection failed");
    mockProcessBatch.mockRejectedValueOnce(fetchError);

    await expect(
      processInBatches(mockProcessBatch, mockHandler, mockLogger, {
        batchSize: 5,
      })
    ).rejects.toThrow("Database connection failed");

    expect(mockProcessBatch).toHaveBeenCalledTimes(1);
    expect(mockHandler).not.toHaveBeenCalled();
    expect(mockLoggerFn).toHaveBeenCalledWith(
      expect.objectContaining({ err: fetchError, offset: 0, batchSize: 5 }),
      "Error fetching batch from processBatch."
    );
    expect(mockLoggerFn).not.toHaveBeenCalledWith(
      expect.any(Object),
      "Batch processing finished."
    );
  });

  test("should stop processing if handler throws error", async () => {
    const handlerError = new Error("Failed to process batch item");
    mockProcessBatch
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
      .mockResolvedValueOnce([{ id: 3 }, { id: 4 }])
      .mockResolvedValueOnce([{ id: 5 }]);

    mockHandler
      .mockRejectedValueOnce(handlerError)
      .mockResolvedValue(undefined);

    await expect(
      processInBatches<TestItem>(mockProcessBatch, mockHandler, mockLogger, {
        batchSize: 2,
      })
    ).rejects.toThrow("Failed to process batch item");

    expect(mockProcessBatch).toHaveBeenCalledTimes(3);

    // Handlers for all 3 batches are *started* before Promise.all rejects
    expect(mockHandler).toHaveBeenCalledTimes(3);
    expect(mockHandler).toHaveBeenNthCalledWith(1, [{ id: 1 }, { id: 2 }]);
    expect(mockHandler).toHaveBeenNthCalledWith(2, [{ id: 3 }, { id: 4 }]);
    expect(mockHandler).toHaveBeenNthCalledWith(3, [{ id: 5 }]);

    expect(mockLoggerFn).toHaveBeenCalledWith(
      expect.objectContaining({ err: handlerError, batchNum: 1 }),
      "Error processing batch 1 in handler."
    );
    expect(mockLoggerFn).toHaveBeenCalledWith(
      expect.objectContaining({ err: handlerError }),
      "Error occurred while waiting for concurrent batch handlers. Stopping."
    );

    expect(mockLoggerFn).not.toHaveBeenCalledWith(
      expect.any(Object),
      "Batch processing finished."
    );
  });
});
