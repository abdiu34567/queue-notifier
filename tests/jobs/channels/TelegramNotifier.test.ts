const noOpLogFn = () => {};
const dummySilentLogger = {
  fatal: noOpLogFn,
  error: noOpLogFn,
  warn: noOpLogFn,
  info: noOpLogFn,
  debug: noOpLogFn,
  trace: noOpLogFn,
  child: jest.fn().mockImplementation(() => dummySilentLogger),
  setBindings: jest.fn(),
  level: "silent",
} as any;
jest.mock("../../../src/utils/LoggerFactory", () => ({
  loggerFactory: {
    createLogger: jest.fn().mockReturnValue(dummySilentLogger),
  },
}));

import { Telegraf } from "telegraf";
import { loggerFactory } from "../../../src/utils/LoggerFactory";
import { RateLimiter } from "../../../src/core/RateLimiter";
import { batchSender } from "../../../src/core/BatchSender";
import { TelegramNotifier } from "../../../src/jobs/channels/TelegramNotifier";

// Mock external dependencies
jest.mock("telegraf");
jest.mock("../../../src/utils/LoggerFactory");
jest.mock("../../../src/core/RateLimiter");
jest.mock("../../../src/core/BatchSender");

describe("TelegramNotifier", () => {
  let fakeLogger: any;

  beforeEach(() => {
    jest.clearAllMocks();
    fakeLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      trace: jest.fn(),
      debug: jest.fn(),
    } as any;
    (loggerFactory.createLogger as jest.Mock).mockReturnValue(fakeLogger);
    // (RateLimiter as jest.Mock).mockImplementation(() => ({}));
    (batchSender.process as jest.Mock).mockResolvedValue("fake-result");
  });

  describe("constructor", () => {
    it("should throw if botToken is missing", () => {
      expect(() => new TelegramNotifier({ botToken: "" })).toThrow(
        "Telegram botToken is required."
      );
      expect(fakeLogger.error).toHaveBeenCalled();
    });

    it("should initialize bot and rateLimiter with valid botToken", () => {
      const fakeBot = { telegram: { sendMessage: jest.fn() } };
      (Telegraf as any).mockImplementation(() => fakeBot);

      const notifier = new TelegramNotifier({
        botToken: "token",
        maxMessagesPerSecond: 10,
      });

      expect(Telegraf).toHaveBeenCalledWith("token");
      expect(fakeLogger.info).toHaveBeenCalledWith("Initializing...");
      expect(fakeLogger.info).toHaveBeenCalledWith(
        "Telegraf instance created."
      );
      expect(fakeLogger.info).toHaveBeenCalledWith(
        { rateLimit: 10 },
        "Rate limiter configured."
      );
    });
  });

  describe("send", () => {
    it("should delegate to batchSender.process", async () => {
      const fakeBot = { telegram: { sendMessage: jest.fn() } };
      (Telegraf as any).mockImplementation(() => fakeBot);
      const notifier = new TelegramNotifier({ botToken: "token" });
      const chatIds = ["id1", "id2"];
      const meta = [{ text: "hi" }];
      const result = await notifier.send(chatIds, meta, fakeLogger);

      expect(batchSender.process).toHaveBeenCalledWith(
        chatIds,
        meta,
        expect.anything(),
        expect.any(Function),
        fakeLogger,
        { concurrency: 5 }
      );
      expect(result).toBe("fake-result");
    });
  });

  describe("_sendSingleTelegramMessage", () => {
    it("should return error if missing text", async () => {
      const fakeBot = { telegram: { sendMessage: jest.fn() } };
      (Telegraf as any).mockImplementation(() => fakeBot);
      const notifier = new TelegramNotifier({ botToken: "token" });

      // @ts-ignore accessing private method for testing
      const res = await notifier._sendSingleTelegramMessage(
        "chatId",
        {} as any,
        fakeLogger
      );

      expect(fakeLogger.warn).toHaveBeenCalledWith(
        "Missing text in Telegram meta."
      );
      expect(res).toEqual({
        status: "error",
        recipient: "chatId",
        error: "MISSING_TEXT",
      });
    });

    it("should return success on sendMessage", async () => {
      const fakeResponse = { message_id: 123 };
      const fakeBot = {
        telegram: { sendMessage: jest.fn().mockResolvedValue(fakeResponse) },
      };
      (Telegraf as any).mockImplementation(() => fakeBot);
      const notifier = new TelegramNotifier({ botToken: "token" });

      // @ts-ignore accessing private method for testing
      const res = await notifier._sendSingleTelegramMessage(
        "chatId",
        { text: "hello" },
        fakeLogger
      );

      expect(fakeLogger.trace).toHaveBeenCalledWith(
        { options: expect.any(Object) },
        "Sending message via Telegraf..."
      );
      expect(fakeLogger.debug).toHaveBeenCalledWith(
        { messageId: 123 },
        "Telegram message sent successfully."
      );
      expect(res).toEqual({
        status: "success",
        recipient: "chatId",
        response: fakeResponse,
      });
    });

    it("should return error on sendMessage exception", async () => {
      const error = {
        message: "fail",
        description: "desc",
        code: 400,
        response: { error_code: 400 },
      };
      const fakeBot = {
        telegram: { sendMessage: jest.fn().mockRejectedValue(error) },
      };
      (Telegraf as any).mockImplementation(() => fakeBot);
      const notifier = new TelegramNotifier({ botToken: "token" });

      // @ts-ignore accessing private method for testing
      const res = await notifier._sendSingleTelegramMessage(
        "chatId",
        { text: "hello" },
        fakeLogger
      );

      expect(fakeLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          err: error,
          statusCode: 400,
          description: error.description,
        }),
        "Telegram send error."
      );
      expect(res.status).toBe("error");
      expect(res.recipient).toBe("chatId");
      expect(res.error?.startsWith("400:desc")).toBe(true);
      expect(res.response).toEqual({
        message: "fail",
        description: "desc",
        code: 400,
        responsePayload: { error_code: 400 },
      });
    });
  });
});
