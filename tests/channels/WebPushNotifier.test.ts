const mockSetVapidDetails = jest.fn();
const mockSendNotification = jest.fn().mockResolvedValue({ statusCode: 201 });

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
      notifier.send(subscriptions, { title: "Hello!", body: "Test web push" })
    ).resolves.not.toThrow();

    expect(mockSendNotification).toHaveBeenCalledTimes(subscriptions.length);

    const expectedPayload = JSON.stringify({
      title: "Hello!",
      body: "Test web push",
      data: {},
    });
    expect(mockSendNotification).toHaveBeenLastCalledWith(
      JSON.parse(subscriptions[1]),
      expectedPayload,
      {}
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
      notifier.send(manySubscriptions, {
        title: "Hello!",
        body: "Rate limit test",
      })
    ).resolves.not.toThrow();

    expect(mockSendNotification).toHaveBeenCalled();
  });
});
