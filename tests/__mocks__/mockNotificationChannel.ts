import { NotificationChannel } from "../../src/jobs/channels/NotificationChannel";

export const createMockNotifier = (): jest.Mocked<NotificationChannel> => {
  return {
    send: jest.fn().mockResolvedValue([]),
  };
};
