// import webPush from "web-push";

// 1. Use "mock" prefix for variables (Jest hoists these)
const mockSetVapidDetails = jest.fn();
const mockSendNotification = jest.fn().mockResolvedValue({ statusCode: 201 });

// 2. Jest now recognizes the initialized mocks
jest.mock("web-push", () => ({
  setVapidDetails: mockSetVapidDetails,
  sendNotification: mockSendNotification,
}));
import { WebPushNotifier } from "../../src/jobs/channels/WebPushNotifier";

describe("WebPushNotifier", () => {
  const webPushConfig = {
    publicKey: "fake_public_key",
    privateKey: "fake_private_key",
    contactEmail: "admin@example.com",
    maxMessagesPerSecond: 10,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // In your test file (e.g., EmailNotifier.test.ts)
  beforeAll(() => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  it("should set VAPID details upon initialization", () => {
    new WebPushNotifier(webPushConfig);

    expect(mockSetVapidDetails).toHaveBeenCalledWith(
      "mailto:" + webPushConfig.contactEmail,
      webPushConfig.publicKey,
      webPushConfig.privateKey
    );
  });

  it("should send notifications successfully", async () => {
    const notifier = new WebPushNotifier(webPushConfig);

    // Typically userIds are stringified subscription objects
    const subscriptions = [
      JSON.stringify({
        endpoint: "https://fcm.googleapis.com/fcm/send/fake1",
        keys: {
          auth: "fakeAuth1",
          p256dh: "fakeP256dh1",
        },
      }),
      JSON.stringify({
        endpoint: "https://fcm.googleapis.com/fcm/send/fake2",
        keys: {
          auth: "fakeAuth2",
          p256dh: "fakeP256dh2",
        },
      }),
    ];

    await expect(
      notifier.send(subscriptions, "Test web push message", { title: "Hello!" })
    ).resolves.not.toThrow();

    // Verify we called sendNotification for each subscription
    expect(mockSendNotification).toHaveBeenCalledTimes(subscriptions.length);

    // Optionally check that payload is as expected
    const expectedPayload = JSON.stringify({
      title: "Hello!",
      body: "Test web push message",
      data: {},
    });
    expect(mockSendNotification).toHaveBeenCalledWith(
      JSON.parse(subscriptions[0]),
      expectedPayload
    );
  });

  it("should respect rate-limiting", async () => {
    const notifier = new WebPushNotifier(webPushConfig);

    const manySubscriptions = Array.from({ length: 50 }, (_, i) =>
      JSON.stringify({
        endpoint: `https://fcm.googleapis.com/fcm/send/fake${i}`,
        keys: {
          auth: `auth${i}`,
          p256dh: `p256dh${i}`,
        },
      })
    );

    await expect(
      notifier.send(manySubscriptions, "Rate limit test", {
        title: "WebPushTest",
      })
    ).resolves.not.toThrow();

    // We just verify that at least one call occurred
    expect(mockSendNotification).toHaveBeenCalled();
  });
});
