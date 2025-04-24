const mockLogError = jest.fn();
const mockLogWarn = jest.fn();
const mockLogInfo = jest.fn();
const mockLogDebug = jest.fn();
const mockLogTrace = jest.fn();
const mockLoggerInstance = {
  fatal: jest.fn(),
  error: mockLogError,
  warn: mockLogWarn,
  info: mockLogInfo,
  debug: mockLogDebug,
  trace: mockLogTrace,
  child: jest.fn().mockImplementation(() => mockLoggerInstance),
  setBindings: jest.fn(),
  level: "silent",
} as any;
jest.mock("../../../src/utils/LoggerFactory", () => ({
  __esModule: true,
  loggerFactory: {
    createLogger: jest.fn().mockReturnValue(mockLoggerInstance),
  },
}));

jest.mock("web-push", () => ({
  __esModule: true,
  default: {
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn(),
  },
  WebPushError: class WebPushError extends Error {},
}));
jest.mock("../../../src/core/RateLimiter");
jest.mock("../../../src/core/BatchSender");

import webPush from "web-push";
import { loggerFactory } from "../../../src/utils/LoggerFactory";
import { RateLimiter } from "../../../src/core/RateLimiter";
import { batchSender } from "../../../src/core/BatchSender";
import { WebPushNotifier } from "../../../src/jobs/channels/WebPushNotifier";
import type { Logger as PinoLogger } from "pino";
import type { WebPushError } from "web-push";
import { WebPushMeta } from "../../../src/jobs/channels/NotificationChannel";

describe("WebPushNotifier", () => {
  let fakeLogger: jest.Mocked<PinoLogger>;
  let fakeRateLimiter: any;

  beforeEach(() => {
    jest.clearAllMocks();

    fakeLogger = mockLoggerInstance;
    (loggerFactory.createLogger as jest.Mock).mockReturnValue(fakeLogger);

    fakeRateLimiter = {};
    (RateLimiter as jest.Mock).mockImplementation(() => fakeRateLimiter);

    (batchSender.process as jest.Mock).mockResolvedValue(["batch-result"]);

    (webPush.setVapidDetails as jest.Mock).mockClear();
    (webPush.sendNotification as jest.Mock).mockClear();
  });

  describe("constructor", () => {
    it("throws if missing VAPID config", () => {
      expect(
        () =>
          new WebPushNotifier({
            publicKey: "",
            privateKey: "",
            contactEmail: "",
          })
      ).toThrow(
        "WebPushNotifier requires publicKey, privateKey, and contactEmail."
      );
      expect(fakeLogger.error).toHaveBeenCalled();
    });

    it("sets VAPID details and rateLimiter with valid config", () => {
      const config = {
        publicKey: "pub",
        privateKey: "priv",
        contactEmail: "test@example.com",
        maxMessagesPerSecond: 20,
      };

      const notifier = new WebPushNotifier(config);

      expect(webPush.setVapidDetails).toHaveBeenCalledWith(
        "mailto:" + config.contactEmail,
        config.publicKey,
        config.privateKey
      );
      expect(fakeLogger.info).toHaveBeenCalledWith("Initializing...");
      expect(fakeLogger.info).toHaveBeenCalledWith(
        "VAPID details set successfully."
      );
      expect(fakeLogger.info).toHaveBeenCalledWith(
        { rateLimit: 20 },
        "Rate limiter configured."
      );

      expect(RateLimiter).toHaveBeenCalledWith(20, 1000);
      expect(loggerFactory.createLogger).toHaveBeenCalledWith({
        component: "WebPushNotifier",
      });
    });
  });

  describe("send", () => {
    it("delegates to batchSender.process", async () => {
      const notifier = new WebPushNotifier({
        publicKey: "p",
        privateKey: "k",
        contactEmail: "c@e.com",
      });
      const subs = ["{}"];
      const meta = [{ title: "T", body: "B", data: {} }];

      const res = await notifier.send(subs, meta, fakeLogger);

      expect(batchSender.process).toHaveBeenCalledWith(
        subs,
        meta,
        fakeRateLimiter,
        expect.any(Function),
        fakeLogger,
        { concurrency: 5 }
      );
      expect(res).toEqual(["batch-result"]);
    });
  });

  describe("_sendSingleWebPush", () => {
    const sendFnName = "_sendSingleWebPush" as keyof WebPushNotifier;

    it("returns error for invalid JSON subscription", async () => {
      const notifier = new WebPushNotifier({
        publicKey: "p",
        privateKey: "k",
        contactEmail: "c@e.com",
      });
      const invalid = "not-json";

      const result = await (notifier as any)[sendFnName](
        invalid,
        { title: "T", body: "B", data: {} },
        {
          ...fakeLogger,
          bindings: () => ({ index: 2 }),
          setBindings: jest.fn(),
        }
      );

      expect(fakeLogger.warn).toHaveBeenCalled();
      expect(result).toEqual({
        status: "error",
        recipient: "unparseable_sub_at_index_2",
        error: "INVALID_SUBSCRIPTION_STRING",
        response: expect.any(String),
      });
    });

    it("returns error for invalid meta", async () => {
      const notifier = new WebPushNotifier({
        publicKey: "p",
        privateKey: "k",
        contactEmail: "c@e.com",
      });
      const sub = JSON.stringify({
        endpoint: "e",
        keys: { p256dh: "p", auth: "a" },
      });
      const result = await (notifier as any)[sendFnName](sub, null as any, {
        ...fakeLogger,
        bindings: () => ({ index: 0 }),
        setBindings: jest.fn(),
      });

      expect(fakeLogger.warn).toHaveBeenCalledWith(
        "Skipping subscription due to missing or invalid meta object."
      );
      expect(result).toEqual({
        status: "error",
        recipient: "e",
        error: "INVALID_META",
        response: "Missing or invalid meta for recipient",
      });
    });

    it("sends notification successfully", async () => {
      const notifier = new WebPushNotifier({
        publicKey: "p",
        privateKey: "k",
        contactEmail: "c@e.com",
      });
      const subscription = { endpoint: "e", keys: { p256dh: "p", auth: "a" } };
      const subStr = JSON.stringify(subscription);
      const userMeta: WebPushMeta = {
        title: "T",
        body: "B",
        data: {},
        TTL: 60,
        headers: { h: "v" },
      };
      const headers = { h: "v" };
      userMeta["headers"] = headers;

      (webPush.sendNotification as jest.Mock).mockResolvedValue({
        statusCode: 201,
        headers: { h: "v2" },
      });

      const taskLogger = {
        ...fakeLogger,
        bindings: () => ({ index: 1 }),
        setBindings: jest.fn(),
      };
      const res = await (notifier as any)[sendFnName](
        subStr,
        userMeta,
        taskLogger
      );

      expect(taskLogger.trace).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.any(Object),
          payloadSize: expect.any(Number),
        }),
        "Sending notification via web-push..."
      );
      expect(taskLogger.debug).toHaveBeenCalledWith(
        { statusCode: 201 },
        "Web Push sent successfully."
      );
      expect(res).toEqual({
        status: "success",
        recipient: "e",
        response: { statusCode: 201, headers: { h: "v2" } },
      });
    });

    it("formats errors from WebPushError correctly", async () => {
      const notifier = new WebPushNotifier({
        publicKey: "p",
        privateKey: "k",
        contactEmail: "c@e.com",
      });
      const subscription = { endpoint: "e", keys: { p256dh: "p", auth: "a" } };
      const subStr = JSON.stringify(subscription);
      const userMeta = { title: "T", body: "B", data: {} };

      const error = new (require("web-push").WebPushError)("fail");
      (error as any).body = "bad";
      (error as any).statusCode = 500;
      (webPush.sendNotification as jest.Mock).mockRejectedValue(error);

      const taskLogger = {
        ...fakeLogger,
        bindings: () => ({ index: 3 }),
        setBindings: jest.fn(),
      };
      const res = await (notifier as any)[sendFnName](
        subStr,
        userMeta,
        taskLogger
      );

      expect(taskLogger.warn).toHaveBeenCalled();
      expect(res.status).toBe("error");
      expect(res.recipient).toBe("e");
      expect(res.error).toMatch(/^500:bad/);
      expect(res.response).toMatchObject({
        statusCode: 500,
        message: "bad",
        originalError: error,
      });
    });
  });
});
