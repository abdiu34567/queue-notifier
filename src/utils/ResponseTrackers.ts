import Redis from "ioredis";
import { Logger as PinoLogger } from "pino";
import { NotificationResult } from "../jobs/channels/NotificationChannel";

/**
 * Creates the final tracking key string from a NotificationResult.
 * Assumes result.error contains the core key components formatted by the notifier.
 */
function getErrorTrackingKey(result: NotificationResult): string {
  if (result.status === "success") {
    return "success";
  }

  const errorKeyBody = result.error || "UNKNOWN_ERROR";
  const finalKey = `error:${errorKeyBody}`;
  return finalKey;
}

export async function trackNotificationResponse(
  redis: Redis,
  trackingKey: string,
  response: any,
  logger: PinoLogger
) {
  const trackLogger = logger.child({
    component: "ResponseTracker",
    trackingKey,
  });
  trackLogger.trace({ response }, "Tracking notification response...");

  try {
    const pipeline = redis.pipeline();
    let updates = 0;

    if (Array.isArray(response)) {
      // Handling results per recipient
      for (const res of response) {
        let statusKey: string;
        if (res.status === "success") {
          statusKey = "success";
        } else {
          statusKey = getErrorTrackingKey(res);
        }
        pipeline.hincrby(trackingKey, statusKey, 1);
        updates++;
      }
    } else if (response && response.success === false) {
      const statusKey = getErrorTrackingKey(response);
      pipeline.hincrby(trackingKey, statusKey, 1);
      updates++;
    } else if (response) {
      trackLogger.warn(
        { response },
        "Received unexpected response format for tracking."
      );
      pipeline.hincrby(trackingKey, "error:invalid_response_format", 1);
      updates++;
    }

    if (updates > 0) {
      await pipeline.exec();
      trackLogger.debug({ updates }, "Stats updated in Redis.");
    } else {
      trackLogger.debug("No updates to track.");
    }
  } catch (err) {
    trackLogger.error(
      { err },
      "Failed to track notification response in Redis."
    );
  }
}

export async function getNotificationStats(
  redis: Redis,
  trackingKey: string = "notifications:stats",
  logger: PinoLogger
) {
  const trackLogger = logger.child({
    component: "ResponseTracker",
    trackingKey,
  });
  trackLogger.trace("Getting notification stats...");

  try {
    const stats = await redis.hgetall(trackingKey);
    trackLogger.debug({ stats }, "Retrieved stats.");
    return stats;
  } catch (err) {
    trackLogger.error({ err }, "Failed to get notification stats from Redis.");
    return {};
  }
}

export async function resetNotificationStats(
  redis: Redis,
  trackingKey: string = "notifications:stats",
  logger: PinoLogger
) {
  const trackLogger = logger.child({
    component: "ResponseTracker",
    trackingKey,
  });
  trackLogger.warn("Resetting notification stats...");
  try {
    await redis.del(trackingKey);
    trackLogger.info("Notification Stats Reset.");
  } catch (err) {
    trackLogger.error({ err }, "Failed to reset notification stats in Redis.");
  }
}
