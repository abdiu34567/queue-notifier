import { batchSender } from "../../src/core/BatchSender";
import {
  createMockLogger,
  mockLoggerFn,
  clearMockLogger,
} from "../__mocks__/pino";
import { RateLimiter } from "../../src/core/RateLimiter";
import { NotificationResult } from "../../src/jobs/channels/NotificationChannel";

const mockSchedule = jest.fn().mockImplementation(async (fn) => await fn());

jest.mock("../../src/core/RateLimiter", () => {
  return {
    RateLimiter: jest.fn().mockImplementation(() => {
      return {
        schedule: mockSchedule,
      };
    }),
  };
});

const MockedRateLimiter = RateLimiter as jest.MockedClass<typeof RateLimiter>;

type TestRecipient = string;
interface TestMeta {
  data: string;
}

const clearRateLimiterMocks = () => {
  MockedRateLimiter.mockClear();
  mockSchedule.mockClear();
};

describe("batchSender", () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockSendSingle: jest.Mock<
    Promise<NotificationResult>,
    [recipient: TestRecipient, meta: TestMeta, logger: any]
  >;

  beforeEach(() => {
    mockLogger = createMockLogger("info");
    clearMockLogger();
    clearRateLimiterMocks();
    mockSendSingle = jest.fn();
  });

  test("should process all recipients successfully", async () => {
    const recipients: TestRecipient[] = ["user1", "user2", "user3"];
    const meta: TestMeta[] = [{ data: "m1" }, { data: "m2" }, { data: "m3" }];

    mockSendSingle.mockImplementation(
      async (recipient, metaData, logger): Promise<NotificationResult> => {
        return {
          status: "success",
          recipient,
          response: `Sent ${metaData.data}`,
        };
      }
    );

    const rateLimiterInstance = new RateLimiter(10, 1000);

    const results = await batchSender.process(
      recipients,
      meta,
      rateLimiterInstance,
      mockSendSingle,
      mockLogger,
      { concurrency: 2 }
    );

    expect(results).toHaveLength(3);
    expect(results).toEqual([
      { status: "success", recipient: "user1", response: "Sent m1" },
      { status: "success", recipient: "user2", response: "Sent m2" },
      { status: "success", recipient: "user3", response: "Sent m3" },
    ]);
    expect(mockSendSingle).toHaveBeenCalledTimes(3);
    expect(mockSchedule).toHaveBeenCalledTimes(3);
    expect(mockLoggerFn).toHaveBeenCalledWith(
      expect.objectContaining({
        successCount: 3,
        failureCount: 0,
        skippedCount: 0,
      }),
      "Finished batch processing via BatchSender."
    );
  });

  test("should handle partial failures from sendSingle", async () => {
    const recipients: TestRecipient[] = ["user1", "user2-fail", "user3"];
    const meta: TestMeta[] = [{ data: "m1" }, { data: "m2" }, { data: "m3" }];

    mockSendSingle.mockImplementation(
      async (recipient, metaData): Promise<NotificationResult> => {
        if (recipient === "user2-fail") {
          return { status: "error", recipient, error: "Failed to send" };
        }
        return {
          status: "success",
          recipient,
          response: `Sent ${metaData.data}`,
        };
      }
    );

    const rateLimiterInstance = new RateLimiter(10, 1000);

    const results = await batchSender.process(
      recipients,
      meta,
      rateLimiterInstance,
      mockSendSingle,
      mockLogger
    );

    expect(results).toHaveLength(3);
    expect(results).toEqual([
      { status: "success", recipient: "user1", response: "Sent m1" },
      { status: "error", recipient: "user2-fail", error: "Failed to send" },
      { status: "success", recipient: "user3", response: "Sent m3" },
    ]);
    expect(mockSendSingle).toHaveBeenCalledTimes(3);
    expect(mockSchedule).toHaveBeenCalledTimes(3);
    expect(mockLoggerFn).toHaveBeenCalledWith(
      expect.objectContaining({
        successCount: 2,
        failureCount: 1,
        skippedCount: 0,
      }),
      "Finished batch processing via BatchSender."
    );
  });

  test("should handle unexpected errors thrown by sendSingle", async () => {
    const recipients: TestRecipient[] = ["user1", "user2-throw", "user3"];
    const meta: TestMeta[] = [{ data: "m1" }, { data: "m2" }, { data: "m3" }];
    const throwError = new Error("Internal send error");

    mockSendSingle.mockImplementation(
      async (recipient, metaData, logger): Promise<NotificationResult> => {
        if (recipient === "user2-throw") {
          throw throwError;
        }
        return {
          status: "success",
          recipient,
          response: `Sent ${metaData.data}`,
        };
      }
    );

    const rateLimiterInstance = new RateLimiter(10, 1000);

    const results = await batchSender.process(
      recipients,
      meta,
      rateLimiterInstance,
      mockSendSingle,
      mockLogger
    );

    expect(results).toHaveLength(3);
    expect(results).toEqual([
      { status: "success", recipient: "user1", response: "Sent m1" },
      {
        status: "error",
        recipient: "user2-throw",
        error: "INTERNAL_SEND_ERROR",
        response: "Internal send error",
      },
      { status: "success", recipient: "user3", response: "Sent m3" },
    ]);
    expect(mockSendSingle).toHaveBeenCalledTimes(3);
    expect(mockSchedule).toHaveBeenCalledTimes(3);
    expect(mockLoggerFn).toHaveBeenCalledWith(
      expect.objectContaining({ err: throwError }),
      "Unexpected error executing sendSingle function."
    );
    expect(mockLoggerFn).toHaveBeenCalledWith(
      expect.objectContaining({
        successCount: 2,
        failureCount: 1,
        skippedCount: 0,
      }),
      "Finished batch processing via BatchSender."
    );
  });

  test("should handle skipped recipients due to invalid input", async () => {
    const recipients: TestRecipient[] = ["user1", "", "user3", "user4"];
    const meta: TestMeta[] = [
      { data: "m1" },
      { data: "m2" },
      undefined as any,
      { data: "m4" },
    ];

    mockSendSingle.mockImplementation(
      async (recipient, metaData): Promise<NotificationResult> => {
        return {
          status: "success",
          recipient,
          response: `Sent ${metaData.data}`,
        };
      }
    );

    const rateLimiterInstance = new RateLimiter(10, 1000);

    const results = await batchSender.process(
      recipients,
      meta,
      rateLimiterInstance,
      mockSendSingle,
      mockLogger
    );

    expect(results).toHaveLength(4);
    expect(results).toEqual([
      { status: "success", recipient: "user1", response: "Sent m1" },
      {
        status: "error",
        recipient: "invalid_recipient_at_index_1",
        error: "Invalid recipient data",
      },
      {
        status: "error",
        recipient: "user3",
        error: "Missing meta for recipient",
      },
      { status: "success", recipient: "user4", response: "Sent m4" },
    ]);
    expect(mockSendSingle).toHaveBeenCalledTimes(2);
    expect(mockSchedule).toHaveBeenCalledTimes(2);
    expect(mockLoggerFn).toHaveBeenCalledWith(
      expect.objectContaining({
        successCount: 2,
        failureCount: 0,
        skippedCount: 2,
      }),
      "Finished batch processing via BatchSender."
    );
    expect(mockLoggerFn).toHaveBeenCalledWith(
      expect.objectContaining({ validationRule: "missingOrEmptyRecipient" }),
      expect.stringContaining("Skipping invalid recipient")
    );
    expect(mockLoggerFn).toHaveBeenCalledWith(
      expect.objectContaining({ validationRule: "missingMeta" }),
      expect.stringContaining("Skipping recipient due to missing meta")
    );
  });

  test("should handle empty recipient array", async () => {
    const recipients: TestRecipient[] = [];
    const meta: TestMeta[] = [];

    const rateLimiterInstance = new RateLimiter(10, 1000);

    const results = await batchSender.process(
      recipients,
      meta,
      rateLimiterInstance,
      mockSendSingle,
      mockLogger
    );

    expect(results).toEqual([]);
    expect(mockSendSingle).not.toHaveBeenCalled();
    expect(mockSchedule).not.toHaveBeenCalled();
    expect(mockLoggerFn).toHaveBeenCalledWith(
      expect.objectContaining({
        successCount: 0,
        failureCount: 0,
        skippedCount: 0,
      }),
      "Finished batch processing via BatchSender."
    );
  });
});
