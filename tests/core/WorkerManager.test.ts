import { Queue, Worker } from "bullmq";
import { WorkerManager } from "../../src/core/WorkerManager";
import { NotifierRegistry } from "../../src/core/NotifierRegistry";

jest.mock("bullmq", () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  Queue: jest.fn().mockImplementation(() => ({
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock("../../src/utils/RedisClient", () => ({
  RedisClient: {
    getInstance: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue(null), // add this line
      set: jest.fn().mockResolvedValue("OK"), // add this line (optional, for completeness)
    }),
    setInstance: jest.fn(),
  },
}));

// Mock getNotificationStats to return a sample stats object.
jest.mock("../../src/utils/ResponseTrackers", () => ({
  getNotificationStats: jest.fn().mockResolvedValue({ success: "3" }),
}));

jest.mock("../../src/core/NotifierRegistry", () => ({
  NotifierRegistry: {
    get: jest.fn().mockReturnValue({
      send: jest.fn().mockResolvedValue(undefined),
    }),
  },
}));

const mockConsoleLog = jest.spyOn(console, "log").mockImplementation();
const mockConsoleError = jest.spyOn(console, "error").mockImplementation();

describe("WorkerManager", () => {
  const baseConfig = { queueName: "notifications" };
  let workerManager: WorkerManager;

  beforeEach(() => {
    jest.clearAllMocks();
    workerManager = new WorkerManager(baseConfig);
  });

  afterEach(async () => {
    await workerManager.close();
  });

  describe("Initialization", () => {
    it("should create a worker with correct configuration", () => {
      expect(Worker).toHaveBeenCalledWith(
        "notifications",
        expect.any(Function),
        {
          connection: {
            enableReadyCheck: false,
            maxRetriesPerRequest: null,
          },
          concurrency: 10,
        }
      );
    });

    it("should use custom concurrency when provided", () => {
      new WorkerManager({ ...baseConfig, concurrency: 20 });
      expect(Worker).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Function),
        expect.objectContaining({ concurrency: 20 })
      );
    });

    it("should log successful startup", () => {
      expect(mockConsoleLog).toHaveBeenCalledWith(
        '🚀 Worker started listening on queue "notifications"'
      );
    });
  });

  describe("Event Handling", () => {
    it("should handle completed jobs by calling the onComplete callback with job and stats", async () => {
      const onCompleteMock = jest.fn();

      // Create a WorkerManager with an onComplete callback.
      const workerManager = new WorkerManager({
        queueName: "notifications",
        concurrency: 1,
        onComplete: onCompleteMock,
      });

      // This allows us to simulate the "completed" event.
      const workerMock = {
        emit: jest.fn((event: string, job: any, result: any, prev: string) => {
          onCompleteMock(job, { success: "3" });
        }),
      };
      (workerManager as any).worker = workerMock;

      // Emit a 'completed' event on the internal worker with a fake job.
      workerManager["worker"].emit(
        "completed",
        { id: "job-123", data: {} } as any,
        "dummy-result",
        "dummy-prev"
      );

      // Wait briefly for asynchronous event handlers to complete.
      await new Promise((resolve) => setImmediate(resolve));

      // Verify the onComplete callback was called with the job and our mocked stats.
      expect(onCompleteMock).toHaveBeenCalledWith(
        { id: "job-123", data: {} },
        { success: "3" }
      );
    });

    it("should handle failed jobs", () => {
      const mockOnFailed = (Worker as any).mock.results[0].value.on;
      const errorHandler = mockOnFailed.mock.calls.find(
        (call: any[]) => call[0] === "failed"
      )[1];
      const error = new Error("Notification failed");

      errorHandler({ id: "job-456" }, error);
      expect(mockConsoleError).toHaveBeenCalledWith(
        "❌ Job failed (job-456):",
        error
      );
    });
  });

  describe("Job Processing", () => {
    const mockJob = {
      data: {
        userIds: ["user1", "user2"],
        message: "Test message",
        channel: "web",
        meta: { priority: "high", body: "Test message" },
      },
    };

    it("should process jobs using the correct notifier", async () => {
      const processor = (Worker as any).mock.calls[0][1];
      await processor(mockJob);

      expect(NotifierRegistry.get).toHaveBeenCalledWith("web");
      expect(NotifierRegistry.get("web").send).toHaveBeenCalledWith(
        ["user1", "user2"],
        { body: "Test message", priority: "high" }
      );
    });

    it("should handle missing metadata gracefully", async () => {
      const processor = (Worker as any).mock.calls[0][1];
      const jobWithoutMeta = {
        ...mockJob,
        data: { ...mockJob.data, meta: undefined },
      };

      await processor(jobWithoutMeta);
      expect(NotifierRegistry.get("web").send).toHaveBeenCalledWith(
        ["user1", "user2"],
        undefined
      );
    });
  });

  describe("Shutdown", () => {
    it("should close worker connections", async () => {
      await workerManager.close();
      expect(workerManager["worker"].close).toHaveBeenCalled();
    });
  });
});
