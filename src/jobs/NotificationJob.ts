import { NotifierRegistry } from "../core/NotifierRegistry";
import { BaseJob } from "./BaseJob";
import { NotificationChannel } from "./channels/NotificationChannel";

interface NotificationPayload {
  userIds: string[];
  message: string;
  meta?: Record<string, any>;
  channel: "firebase" | "telegram" | "email" | "web";
}

export class NotificationJob extends BaseJob<NotificationPayload> {
  type = "notification";
  constructor(payload: NotificationPayload) {
    super(payload);
  }

  async execute(): Promise<void> {
    // Retrieve the correct notifier at execution time instead of storing it
    const notifier: NotificationChannel = NotifierRegistry.get(
      this.payload.channel
    );

    await notifier.send(
      this.payload.userIds,
      this.payload.message,
      this.payload.meta
    );
  }
}
