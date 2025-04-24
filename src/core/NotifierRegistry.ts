import { loggerFactory } from "../utils/LoggerFactory";
import { NotificationChannel } from "../jobs/channels/NotificationChannel";

// Create a logger specific to this registry
const registryLogger = loggerFactory.createLogger({
  component: "NotifierRegistry",
});

export class NotifierRegistry {
  private static registry: Map<string, NotificationChannel> = new Map();

  /**
   * Registers a notifier instance for a specific channel name.
   * @param channelName - The name of the channel (e.g., "email", "firebase").
   * @param notifier - An instance implementing the NotificationChannel interface.
   */
  static register(channelName: string, notifier: NotificationChannel) {
    if (this.registry.has(channelName)) {
      registryLogger.warn(
        { channel: channelName },
        `Notifier is being re-registered. Overwriting previous instance.`
      );
    } else {
      registryLogger.info({ channel: channelName }, `Registering notifier.`);
    }
    this.registry.set(channelName, notifier);
  }

  /**
   * Retrieves the notifier instance for a given channel name.
   * @param channelName - The name of the channel.
   * @returns The registered NotificationChannel instance.
   * @throws {Error} If no notifier is registered for the channel name.
   */
  static get(channelName: string): NotificationChannel {
    const notifier = this.registry.get(channelName);
    if (!notifier) {
      registryLogger.error(
        { channel: channelName },
        `Attempted to get notifier, but it was not registered.`
      );
      throw new Error(`Notifier for channel "${channelName}" not registered.`);
    }
    registryLogger.trace({ channel: channelName }, `Retrieved notifier.`); // TRACE level for successful get
    return notifier;
  }

  /**
   * Removes a notifier from the registry.
   * @param channelName - The name of the channel to unregister.
   */
  static unregister(channelName: string): void {
    const deleted = this.registry.delete(channelName);
    if (deleted) {
      registryLogger.info({ channel: channelName }, `Unregistered notifier.`);
    } else {
      registryLogger.warn(
        { channel: channelName },
        `Attempted to unregister notifier, but it was not found.`
      );
    }
  }

  /**
   * Gets the names of all registered channels.
   * @returns {string[]} An array of registered channel names.
   */
  static getRegisteredChannels(): string[] {
    return Array.from(this.registry.keys());
  }

  /**
   * Clears all registered notifiers. (Useful for testing teardown)
   */
  static clear(): void {
    registryLogger.warn("Clearing all registered notifiers.");
    this.registry.clear();
  }
}
