import { NotifierRegistry } from "../../src/core/NotifierRegistry";
import { NotificationChannel } from "../../src/jobs/channels/NotificationChannel";

class DummyNotifier implements NotificationChannel {
  async send(
    userIds: string[],
    message: string,
    meta?: Record<string, any>
  ): Promise<
    { status: string; recipient: string; response?: any; error?: string }[]
  > {
    return userIds.map((userId) => ({
      status: "success",
      recipient: userId,
      response: `Dummy response for ${message}`,
    }));
  }
}

describe("NotifierRegistry", () => {
  beforeEach(() => {
    // Clear the registry for a clean state before each test.
    // Since our registry is a static Map without an explicit reset method,
    // we can manually clear it using (NotifierRegistry as any).registry.clear()
    (NotifierRegistry as any).registry.clear();
  });

  it("should register and retrieve a notifier successfully", () => {
    const dummy = new DummyNotifier();
    NotifierRegistry.register("dummy", dummy);

    const retrieved = NotifierRegistry.get("dummy");
    expect(retrieved).toBe(dummy);
  });

  it("should throw an error if notifier is not registered", () => {
    expect(() => NotifierRegistry.get("nonexistent")).toThrowError(
      "Notifier for nonexistent not registered"
    );
  });

  it("should overwrite an existing notifier for the same channel name", () => {
    const dummy1 = new DummyNotifier();
    const dummy2 = new DummyNotifier();

    NotifierRegistry.register("dummy", dummy1);
    // Overwrite with dummy2
    NotifierRegistry.register("dummy", dummy2);

    const retrieved = NotifierRegistry.get("dummy");
    expect(retrieved).toBe(dummy2);
  });
});
