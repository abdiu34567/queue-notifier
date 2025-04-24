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

const mockInitializeApp = jest.fn(() => mockFirebaseApp);
const mockGetApp = jest.fn(() => mockFirebaseApp);
const mockMessagingSend = jest.fn();
const mockAppMessaging = jest.fn(() => ({ send: mockMessagingSend }));
const mockFirebaseApp = { messaging: mockAppMessaging };

jest.mock("firebase-admin", () => {
  const mockMessagingSend = jest.fn();
  const mockAppMessaging = jest.fn(() => ({ send: mockMessagingSend }));
  const mockFirebaseApp = { messaging: mockAppMessaging };
  const mockInitializeApp = jest.fn(() => mockFirebaseApp);
  const mockGetApp = jest.fn(() => mockFirebaseApp);
  const mockCredentialCert = jest.fn(() => ({ type: "mock-credential" }));

  return {
    initializeApp: mockInitializeApp,
    app: mockGetApp,
    apps: [],
    credential: { cert: mockCredentialCert },
  };
});

const getFirebaseMocks = () => {
  const mockedAdmin = jest.requireMock("firebase-admin");
  return {
    mockInitializeApp: mockedAdmin.initializeApp as jest.Mock,
    mockGetApp: mockedAdmin.app as jest.Mock,
    mockCredentialCert: mockedAdmin.credential.cert as jest.Mock,
    mockMessagingSend: mockedAdmin.app().messaging().send as jest.Mock,
    resetApps: () => {
      mockedAdmin.apps.length = 0;
    },
  };
};

const mockSchedule = jest.fn().mockImplementation(async (fn) => await fn());
jest.mock("../../../src/core/RateLimiter", () => ({
  RateLimiter: jest.fn().mockImplementation((maxReq, perMs) => {
    return {
      schedule: mockSchedule,
    };
  }),
}));
const MockedRateLimiter = jest.requireMock(
  "../../../src/core/RateLimiter"
).RateLimiter;
const mockBatchSenderProcess = jest.fn();
jest.mock("../../../src/core/BatchSender", () => ({
  batchSender: {
    process: mockBatchSenderProcess,
  },
}));

import { FirebaseNotifier } from "../../../src/jobs/channels/FirebaseNotifier";
import { FirebaseMeta } from "../../../src/jobs/channels/NotificationChannel";
import { ServiceAccount } from "firebase-admin/app";

describe("FirebaseNotifier", () => {
  const mockCredentialObject: ServiceAccount = {
    projectId: "mock-project-id",
    clientEmail: "mock-client-email@example.com",
    privateKey: "mock-private-key",
  };
  const mockCredentialPath = "/path/to/fake/key.json";

  beforeEach(() => {
    jest.clearAllMocks();
    getFirebaseMocks().resetApps();
    (FirebaseNotifier as any).initialized = false;
    getFirebaseMocks().mockMessagingSend.mockResolvedValue("mock-message-id");
    // mockBatchSenderProcess.mockImplementation(/* ... */);
  });

  test("constructor should initialize firebase with object credentials if no apps exist", () => {
    const { mockInitializeApp, mockCredentialCert } = getFirebaseMocks();
    const notifier = new FirebaseNotifier(mockCredentialObject);

    expect(mockCredentialCert).toHaveBeenCalledWith(mockCredentialObject);
    expect(mockInitializeApp).toHaveBeenCalledTimes(1);
    expect(mockInitializeApp).toHaveBeenCalledWith({
      credential: { type: "mock-credential" },
    });
    expect(MockedRateLimiter).toHaveBeenCalledWith(500, 1000);
  });

  test("constructor should initialize firebase with path credentials if no apps exist", () => {
    const { mockInitializeApp, mockCredentialCert } = getFirebaseMocks();
    const notifier = new FirebaseNotifier(mockCredentialPath);

    expect(mockCredentialCert).toHaveBeenCalledWith(mockCredentialPath);
    expect(mockInitializeApp).toHaveBeenCalledTimes(1);
  });

  test("constructor should use provided rate limit", () => {
    const notifier = new FirebaseNotifier(mockCredentialObject, {
      maxMessagesPerSecond: 100,
    });
    expect(MockedRateLimiter).toHaveBeenCalledWith(100, 1000);
  });

  test("send should call batchSender.process with correct arguments", async () => {
    const notifier = new FirebaseNotifier(mockCredentialObject);
    const tokens = ["token1", "token2"];
    const meta: FirebaseMeta[] = [{ title: "T1" }, { title: "T2" }];

    await notifier.send(tokens, meta, dummySilentLogger);

    expect(mockBatchSenderProcess).toHaveBeenCalledTimes(1);
    expect(mockBatchSenderProcess).toHaveBeenCalledWith(
      tokens,
      meta,
      expect.any(Object),
      expect.any(Function),
      dummySilentLogger,
      { concurrency: 5 }
    );
  });

  test("_sendSingleFCM should call messaging.send with correct payload", async () => {
    const { mockMessagingSend } = getFirebaseMocks();
    const notifier = new FirebaseNotifier(mockCredentialObject);
    const token = "test-token";
    const userMeta: FirebaseMeta = {
      title: "Hello",
      body: "World",
      data: { k: "v" },
    };
    const expectedMessageId = "msg-1";
    mockMessagingSend.mockResolvedValueOnce(expectedMessageId);

    const result = await (notifier as any)._sendSingleFCM(
      token,
      userMeta,
      dummySilentLogger.child({})
    );

    expect(mockMessagingSend).toHaveBeenCalledTimes(1);
    expect(mockMessagingSend).toHaveBeenCalledWith(
      expect.objectContaining({
        token: token,
        notification: { title: "Hello", body: "World" },
        data: { k: "v" },
      })
    );
    expect(result).toEqual({
      status: "success",
      recipient: token,
      response: expectedMessageId,
    });
  });

  test("_sendSingleFCM should return error if messaging.send fails", async () => {
    const { mockMessagingSend } = getFirebaseMocks();
    const notifier = new FirebaseNotifier(mockCredentialObject);
    const token = "fail-token";
    const userMeta: FirebaseMeta = { title: "Test" };
    const sendError = new Error("Invalid registration token");
    (sendError as any).code = "messaging/invalid-registration-token";
    mockMessagingSend.mockRejectedValueOnce(sendError);

    const result = await (notifier as any)._sendSingleFCM(
      token,
      userMeta,
      dummySilentLogger.child({})
    );

    expect(mockMessagingSend).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: "error",
      recipient: token,
      error: expect.stringContaining("messaging/invalid-registration-token"), // Check error structure
      response: expect.objectContaining({
        code: "messaging/invalid-registration-token",
      }),
    });
  });

  test("_sendSingleFCM should return error if meta is invalid", async () => {
    const notifier = new FirebaseNotifier(mockCredentialObject);
    const token = "bad-meta-token";
    const userMeta = null as any;

    const result = await (notifier as any)._sendSingleFCM(
      token,
      userMeta,
      dummySilentLogger.child({})
    );

    expect(mockMessagingSend).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "error",
      recipient: token,
      error: "Invalid meta for recipient",
    });
  });

  test("_sendSingleFCM should return error if payload is invalid (no notification/data)", async () => {
    const notifier = new FirebaseNotifier(mockCredentialObject);
    const token = "bad-payload-token";
    const userMeta: FirebaseMeta = { android: { priority: "high" } };

    const result = await (notifier as any)._sendSingleFCM(
      token,
      userMeta,
      dummySilentLogger.child({})
    );

    expect(mockMessagingSend).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "error",
      recipient: token,
      error: "INVALID_PAYLOAD",
      response: "Message must contain notification or data",
    });
  });
});
