import Redis from "ioredis";
import Logger from "./Logger";

export class RedisClient {
  private static instance: Redis | null = null;

  // Allow user to set their own instance
  public static setInstance(client: Redis): void {
    RedisClient.instance = client;
    client.on("connect", () => {
      Logger.log("🚀 Redis connected.");
    });
    client.on("error", (error) => {
      Logger.error("❌ Redis error:", error);
    });
  }

  public static getInstance(): Redis {
    if (!RedisClient.instance) {
      throw new Error(
        "Redis instance is not set. Please initialize it using RedisClient.setInstance(client)."
      );
    }
    return RedisClient.instance;
  }
}
