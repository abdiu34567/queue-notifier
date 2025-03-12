export interface NotificationChannel {
  send(
    userIds: string[],
    message: string,
    meta?: Record<string, any>
  ): Promise<void>;
}
