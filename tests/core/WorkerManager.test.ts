import { Worker } from "bullmq";
import { WorkerManager } from "../../src/core/WorkerManager";
import { NotifierRegistry } from "../../src/core/NotifierRegistry";

jest.mock("bullmq", () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock("../../src/utils/RedisClient", () => ({
  RedisClient: {
    getInstance: jest.fn().mockReturnValue({
      redis: "mock-connection",
    }),
    setInstance: jest.fn(),
  },
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
    it("should handle completed jobs", () => {
      const mockOnCompleted = (Worker as any).mock.results[0].value.on;
      const completedHandler = mockOnCompleted.mock.calls.find(
        (call: any[]) => call[0] === "completed"
      )[1];

      completedHandler({ id: "job-123" });
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "✅ Job completed successfully: job-123"
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
