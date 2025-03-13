export interface NotificationChannel {
  send(
    userIds: string[],
    message: string,
    meta?: Record<string, any>
  ): Promise<
    { status: string; recipient: string; response?: any; error?: string }[]
  >;
}
