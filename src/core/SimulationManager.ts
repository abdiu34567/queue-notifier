import Logger from "../utils/Logger";
import { RedisClient } from "../utils/RedisClient";

const SIMULATION_KEY = "worker:simulation_mode";

export class SimulationManager {
  static async enableSimulation(): Promise<void> {
    const redis = RedisClient.getInstance();
    await redis.set(SIMULATION_KEY, "true");
    Logger.log("✅ Simulation mode enabled.");
  }

  static async disableSimulation(): Promise<void> {
    const redis = RedisClient.getInstance();
    await redis.set(SIMULATION_KEY, "false");
    Logger.log("🚫 Simulation mode disabled.");
  }

  static async isSimulationEnabled(): Promise<boolean> {
    const redis = RedisClient.getInstance();
    const mode = await redis.get(SIMULATION_KEY);
    return mode === "true";
  }
}
