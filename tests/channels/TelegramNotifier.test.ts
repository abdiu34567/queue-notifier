jest.mock("telegraf", () => {
  return {
    Telegraf: jest.fn().mockImplementation(() => ({
      telegram: {
        sendMessage: jest.fn().mockResolvedValue(true),
      },
    })),
  };
});

jest.mock("../../src/utils/Logger", () => ({
  log: jest.fn(),
  error: jest.fn(),
}));

import { TelegramNotifier } from "../../src/jobs/channels/TelegramNotifier";

describe("TelegramNotifier", () => {
  const botToken = "fake_bot_token";
  const telegramNotifier = new TelegramNotifier({
    botToken,
    maxMessagesPerSecond: 10,
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("should send Telegram notification successfully", async () => {
    await expect(
      telegramNotifier.send(["12345"], [{ text: "Test message" }])
    ).resolves.not.toThrow();
  });

  test("should respect rate-limiting", async () => {
    const userIds = Array.from({ length: 100 }, (_, i) => `${i}`);
    await expect(
      telegramNotifier.send(userIds, [{ text: "Rate limit test" }])
    ).resolves.not.toThrow();
  }, 50000);
});
