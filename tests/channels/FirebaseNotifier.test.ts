import { FirebaseNotifier } from "../../src/jobs/channels/FirebaseNotifier";
import admin from "firebase-admin";

const sendEachForMulticastMock = jest.fn().mockResolvedValue({
  successCount: 2,
  failureCount: 0,
  responses: [{ success: true }, { success: true }],
});

// Explicitly mock firebase-admin in a stable way
jest.mock("firebase-admin", () => ({
  initializeApp: jest.fn(),
  credential: {
    cert: jest.fn(() => "mocked-cert"), // Ensure Jest correctly mocks the return value
  },
  messaging: jest.fn(() => ({
    sendEachForMulticast: sendEachForMulticastMock,
  })),
}));

describe("FirebaseNotifier", () => {
  const fakeServiceAccount = {
    projectId: "fake_project",
    clientEmail: "fake@example.com",
    privateKey: "fake-key",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  beforeAll(() => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  it("should initialize firebase-admin app correctly", () => {
    new FirebaseNotifier({
      serviceAccount: fakeServiceAccount,
      maxMessagesPerSecond: 10,
    });

    expect(admin.initializeApp).toHaveBeenCalledWith({
      credential: "mocked-cert", // The mocked return value of admin.credential.cert()
    });
  });

  it("should successfully send notifications", async () => {
    const notifier = new FirebaseNotifier({
      serviceAccount: fakeServiceAccount,
      maxMessagesPerSecond: 10,
    });

    const tokens = ["fake_token1", "fake_token2"];

    await expect(
      notifier.send(tokens, { body: "Test notification", title: "Test Title" })
    ).resolves.not.toThrow();

    expect(sendEachForMulticastMock).toHaveBeenCalledTimes(1);
  });

  it("should respect rate-limiting", async () => {
    const notifier = new FirebaseNotifier({
      serviceAccount: fakeServiceAccount,
      maxMessagesPerSecond: 10,
    });

    const manyTokens = Array.from({ length: 100 }, (_, i) => `fake_token_${i}`);

    await expect(
      notifier.send(manyTokens, { body: "Rate limit test", title: "Test" })
    ).resolves.not.toThrow();

    expect(sendEachForMulticastMock).toHaveBeenCalled();
  });
});
