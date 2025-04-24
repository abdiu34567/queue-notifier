const dummyLogFn = () => {};
const dummyLogger = {
  fatal: dummyLogFn,
  error: dummyLogFn,
  warn: dummyLogFn,
  info: dummyLogFn,
  debug: dummyLogFn,
  trace: dummyLogFn,
  child: () => dummyLogger,
  level: "info",
  silent: dummyLogFn,
  setBindings: dummyLogFn,
} as any;

jest.mock("../../src/utils/LoggerFactory", () => ({
  loggerFactory: {
    createLogger: jest.fn().mockReturnValue(dummyLogger),
    setLevel: jest.fn(),
    getLevel: jest.fn().mockReturnValue("info"),
  },
}));

import { NotifierRegistry } from "../../src/core/NotifierRegistry";
import { NotificationChannel } from "../../src/jobs/channels/NotificationChannel";
import { createMockNotifier } from "../__mocks__/mockNotificationChannel";

describe("NotifierRegistry", () => {
  let mockNotifierEmail: jest.Mocked<NotificationChannel>;
  let mockNotifierFirebase: jest.Mocked<NotificationChannel>;

  beforeEach(() => {
    NotifierRegistry.clear();

    // Create fresh mock notifiers for each test
    mockNotifierEmail = createMockNotifier();
    mockNotifierFirebase = createMockNotifier();
  });

  test("should register a new notifier successfully", () => {
    expect(NotifierRegistry.getRegisteredChannels()).toEqual([]);
    NotifierRegistry.register("email", mockNotifierEmail);
    expect(NotifierRegistry.getRegisteredChannels()).toEqual(["email"]);
  });

  test("should overwrite when re-registering a notifier", () => {
    NotifierRegistry.register("email", mockNotifierEmail);
    NotifierRegistry.register("email", mockNotifierFirebase);

    expect(NotifierRegistry.getRegisteredChannels()).toEqual(["email"]);
    expect(NotifierRegistry.get("email")).toBe(mockNotifierFirebase);
  });

  test("should get a registered notifier", () => {
    NotifierRegistry.register("firebase", mockNotifierFirebase);
    const retrievedNotifier = NotifierRegistry.get("firebase");

    expect(retrievedNotifier).toBe(mockNotifierFirebase);
  });

  test("should throw an error when getting an unregistered notifier", () => {
    expect(() => {
      NotifierRegistry.get("sms");
    }).toThrow('Notifier for channel "sms" not registered.');
  });

  // --- unregister ---
  test("should unregister an existing notifier", () => {
    NotifierRegistry.register("email", mockNotifierEmail);
    expect(NotifierRegistry.getRegisteredChannels()).toContain("email");

    NotifierRegistry.unregister("email");

    expect(NotifierRegistry.getRegisteredChannels()).not.toContain("email");
    expect(() => {
      NotifierRegistry.get("email");
    }).toThrow();
  });

  test("should not throw when trying to unregister a non-existent notifier", () => {
    expect(() => {
      NotifierRegistry.unregister("sms");
    }).not.toThrow();
    expect(NotifierRegistry.getRegisteredChannels()).toEqual([]);
  });

  test("should return an array of registered channel names", () => {
    expect(NotifierRegistry.getRegisteredChannels()).toEqual([]);

    NotifierRegistry.register("email", mockNotifierEmail);
    NotifierRegistry.register("firebase", mockNotifierFirebase);

    const channels = NotifierRegistry.getRegisteredChannels();
    expect(channels).toHaveLength(2);
    expect(channels).toEqual(expect.arrayContaining(["email", "firebase"]));
  });

  test("should clear all registered notifiers", () => {
    NotifierRegistry.register("email", mockNotifierEmail);
    NotifierRegistry.register("firebase", mockNotifierFirebase);
    expect(NotifierRegistry.getRegisteredChannels()).toHaveLength(2);
    NotifierRegistry.clear();

    expect(NotifierRegistry.getRegisteredChannels()).toHaveLength(0);
    expect(() => {
      NotifierRegistry.get("email");
    }).toThrow();
    expect(() => {
      NotifierRegistry.get("firebase");
    }).toThrow();
  });
});
