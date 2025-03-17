import { FirebaseNotifier } from "../../src/jobs/channels/FirebaseNotifier";
import admin from "firebase-admin";

const sendMock = jest.fn().mockResolvedValue("mocked-response");

const sendEachForMulticastMock = jest.fn().mockResolvedValue({
  successCount: 2,
  failureCount: 0,
  responses: [{ success: true }, { success: true }],
});

// Explicitly mock firebase-admin in a stable way
jest.mock("firebase-admin", () => ({
  initializeApp: jest.fn(),
  apps: [],
  credential: {
    cert: jest.fn(() => "mocked-cert"),
  },
  messaging: jest.fn(() => ({
    sendEachForMulticast: sendEachForMulticastMock,
    send: sendMock,
  })),
}));

describe("FirebaseNotifier", () => {
  const fakeServiceAccount = {
    projectId: "fake_project",
    clientEmail: "fake@example.com",
    privateKey: "fake-key",
  };

  beforeAll(() => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should initialize firebase-admin app correctly", () => {
    new FirebaseNotifier({
      serviceAccount: fakeServiceAccount,
      maxMessagesPerSecond: 10,
    });

    expect(admin.initializeApp).toHaveBeenCalledWith({
      credential: "mocked-cert",
    });
  }, 50000);

  it("should successfully send notifications", async () => {
    const notifier = new FirebaseNotifier({
      serviceAccount: fakeServiceAccount,
      maxMessagesPerSecond: 10,
    });

    const tokens = ["fake_token1", "fake_token2"];

    await expect(
      notifier.send(tokens, [
        { body: "Test notification", title: "Test Title" },
      ])
    ).resolves.not.toThrow();

    expect(sendMock).toHaveBeenCalledTimes(2);
  }, 50000);

  it("should respect rate-limiting", async () => {
    const notifier = new FirebaseNotifier({
      serviceAccount: fakeServiceAccount,
      maxMessagesPerSecond: 10,
    });

    const manyTokens = Array.from({ length: 100 }, (_, i) => `fake_token_${i}`);

    await expect(
      notifier.send(manyTokens, [{ body: "Rate limit test", title: "Test" }])
    ).resolves.not.toThrow();

    expect(sendMock).toHaveBeenCalled();
  }, 50000);
});
