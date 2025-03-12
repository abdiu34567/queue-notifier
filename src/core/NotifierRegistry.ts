import { NotificationChannel } from "../jobs/channels/NotificationChannel";

export class NotifierRegistry {
  private static registry: Map<string, NotificationChannel> = new Map();

  static register(channelName: string, notifier: NotificationChannel) {
    this.registry.set(channelName, notifier);
  }

  static get(channelName: string): NotificationChannel {
    const notifier = this.registry.get(channelName);
    if (!notifier)
      throw new Error(`Notifier for ${channelName} not registered`);
    return notifier;
  }
}
