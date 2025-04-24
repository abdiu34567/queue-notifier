const dummyLogger: any = {
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
  warn: jest.fn(),
  child: jest.fn().mockReturnThis(),
};

jest.mock("../../src/utils/LoggerFactory", () => ({
  __esModule: true,
  loggerFactory: { createLogger: jest.fn(() => dummyLogger) },
}));
jest.mock("../../src/utils/RedisHandler", () => ({
  __esModule: true,
  ensureRedisInstance: jest.fn(() => "redis-instance"),
}));
jest.mock("../../src/core/NotifierRegistry", () => ({
  __esModule: true,
  NotifierRegistry: { register: jest.fn() },
}));
jest.mock("../../src/jobs/channels/TelegramNotifier", () => ({
  __esModule: true,
  TelegramNotifier: jest.fn((opts: any) => ({ channel: "telegram", opts })),
}));
jest.mock("../../src/jobs/channels/EmailNotifier", () => ({
  __esModule: true,
  EmailNotifier: jest.fn((opts: any) => ({ channel: "email", opts })),
}));
jest.mock("../../src/jobs/channels/FirebaseNotifier", () => ({
  __esModule: true,
  FirebaseNotifier: jest.fn((opts: any) => ({ channel: "firebase", opts })),
}));
jest.mock("../../src/jobs/channels/WebPushNotifier", () => ({
  __esModule: true,
  WebPushNotifier: jest.fn((opts: any) => ({ channel: "web", opts })),
}));
jest.mock("../../src/core/WorkerManager", () => ({
  __esModule: true,
  WorkerManager: jest.fn((params: any) => ({ ...params, close: jest.fn() })),
}));
jest.mock("../../src/utils/ResponseTrackers", () => ({
  __esModule: true,
  resetNotificationStats: jest.fn(),
}));

import { startWorkerServer } from "../../src/utils/StartWorkerServer";
import { loggerFactory } from "../../src/utils/LoggerFactory";
import { ensureRedisInstance } from "../../src/utils/RedisHandler";
import { NotifierRegistry } from "../../src/core/NotifierRegistry";
import { TelegramNotifier } from "../../src/jobs/channels/TelegramNotifier";
import { EmailNotifier } from "../../src/jobs/channels/EmailNotifier";
import { FirebaseNotifier } from "../../src/jobs/channels/FirebaseNotifier";
import { WebPushNotifier } from "../../src/jobs/channels/WebPushNotifier";
import { WorkerManager } from "../../src/core/WorkerManager";
import { resetNotificationStats } from "../../src/utils/ResponseTrackers";
import type { Job } from "bullmq";

describe("startWorkerServer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("throws if redisConnection is missing", () => {
    expect(() => startWorkerServer({} as any)).toThrow(
      "Missing 'redisConnection' in WorkerConfig"
    );
    expect(dummyLogger.error).toHaveBeenCalled();
  });

  it("throws if queueName is missing", () => {
    expect(() => startWorkerServer({ redisConnection: {} } as any)).toThrow(
      "Missing 'queueName' in WorkerConfig"
    );
    expect(dummyLogger.error).toHaveBeenCalled();
  });

  it("registers notifiers and returns WorkerManager instance on valid config", () => {
    const onStart = jest.fn();
    const onComplete = jest.fn();
    const onDrained = jest.fn();
    const config = {
      redisConnection: { host: "h" },
      queueName: "myQueue",
      concurrency: 4,
      trackingKey: "track:key",
      notifiers: {
        telegram: { botToken: "t" },
        email: {
          host: "h",
          port: 1,
          secure: false,
          auth: { user: "u", pass: "p" },
          from: "f",
        },
        firebase: { foo: "bar" } as any,
        web: { publicKey: "pk", privateKey: "sk", contactEmail: "c@e.com" },
      },
      onStart,
      onComplete,
      resetStatsAfterCompletion: true,
      onDrained,
      bullWorkerOptions: { lockDuration: 123 },
    } as any;

    const manager = startWorkerServer(config);

    expect(loggerFactory.createLogger).toHaveBeenCalledWith({
      component: "StartWorkerServer",
      queue: "myQueue",
    });
    expect(ensureRedisInstance).toHaveBeenCalledWith(
      config.redisConnection,
      dummyLogger
    );

    expect(TelegramNotifier).toHaveBeenCalledWith(config.notifiers.telegram);
    expect(EmailNotifier).toHaveBeenCalledWith(config.notifiers.email);
    expect(FirebaseNotifier).toHaveBeenCalledWith(config.notifiers.firebase);
    expect(WebPushNotifier).toHaveBeenCalledWith(config.notifiers.web);
    expect(NotifierRegistry.register).toHaveBeenCalledTimes(4);

    expect(WorkerManager).toHaveBeenCalledWith(
      expect.objectContaining({
        redisConnection: "redis-instance",
        queueName: "myQueue",
        concurrency: 4,
        trackingKey: "track:key",
        bullWorkerOptions: config.bullWorkerOptions,
        onStart,
        onDrained,
        onComplete: expect.any(Function),
      })
    );
    expect(manager).toHaveProperty("close");
  });

  it("onComplete wrapper calls user callback and resets stats", async () => {
    const onComplete = jest.fn();
    const config = {
      redisConnection: {},
      queueName: "q",
      trackingKey: "tk",
      notifiers: {},
      onComplete,
      resetStatsAfterCompletion: true,
    } as any;

    startWorkerServer(config);
    const wmArgs = (WorkerManager as jest.Mock).mock.calls[0][0];
    const fakeJob = { data: { trackingKey: "job:tk" } } as Job;
    const stats = { a: "b" };

    await wmArgs.onComplete(fakeJob, stats, dummyLogger);

    expect(dummyLogger.debug).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith(fakeJob, stats, dummyLogger);
    expect(resetNotificationStats).toHaveBeenCalledWith(
      "redis-instance",
      "job:tk",
      dummyLogger
    );
  });

  it("uses default tracking key when none provided", async () => {
    const config = {
      redisConnection: {},
      queueName: "q",
      notifiers: {},
      resetStatsAfterCompletion: true,
    } as any;

    startWorkerServer(config);
    const wmArgs = (WorkerManager as jest.Mock).mock.calls[0][0];
    const fakeJob = { data: {} } as Job;

    await wmArgs.onComplete(fakeJob, {}, dummyLogger);
    expect(resetNotificationStats).toHaveBeenCalledWith(
      "redis-instance",
      "notifications:stats",
      dummyLogger
    );
  });
});
