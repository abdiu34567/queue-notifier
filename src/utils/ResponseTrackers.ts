import Logger from "./Logger";
import { RedisClient } from "./RedisClient";

export async function trackNotificationResponse(
  trackingKey: string,
  response: any
) {
  const redis = RedisClient.getInstance();

  if (Array.isArray(response)) {
    for (const res of response) {
      const statusKey =
        res.status === "success" ? "success" : res.error || "Unknown error";
      await redis.hincrby(trackingKey, statusKey, 1);
    }
  } else {
    const statusKey = response.success
      ? "success"
      : response.error || "Unknown error";
    await redis.hincrby(trackingKey, statusKey, 1);
  }
}

export async function getNotificationStats(
  trackingKey: string = "notifications:stats"
) {
  const redis = RedisClient.getInstance();
  return await redis.hgetall(trackingKey);
}

export async function resetNotificationStats(
  trackingKey: string = "notifications:stats"
) {
  const redis = RedisClient.getInstance();
  await redis.del(trackingKey);
  Logger.log("🔄 Notification Stats Reset");
}
