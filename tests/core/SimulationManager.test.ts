import Redis from "ioredis";
import { RedisClient } from "../../src/utils/RedisClient";
import { SimulationManager } from "../../src/core/SimulationManager";

// Mock Redis Client
jest.mock("../../src/utils/RedisClient");

describe("SimulationManager", () => {
  let mockRedisGet: jest.Mock;
  let mockRedisSet: jest.Mock;

  beforeAll(() => {
    mockRedisGet = jest.fn();
    mockRedisSet = jest.fn();

    // Mock the getInstance method to return mock Redis client
    (RedisClient.getInstance as jest.Mock).mockReturnValue({
      get: mockRedisGet,
      set: mockRedisSet,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should enable simulation mode", async () => {
    await SimulationManager.enableSimulation();
    expect(mockRedisSet).toHaveBeenCalledWith("worker:simulation_mode", "true");
  });

  it("should disable simulation mode", async () => {
    await SimulationManager.disableSimulation();
    expect(mockRedisSet).toHaveBeenCalledWith(
      "worker:simulation_mode",
      "false"
    );
  });

  it("should correctly report simulation mode as enabled", async () => {
    mockRedisGet.mockResolvedValue("true");
    const result = await SimulationManager.isSimulationEnabled();
    expect(mockRedisGet).toHaveBeenCalledWith("worker:simulation_mode");
    expect(result).toBe(true);
  });

  it("should correctly report simulation mode as disabled", async () => {
    mockRedisGet.mockResolvedValue("false");
    const result = await SimulationManager.isSimulationEnabled();
    expect(mockRedisGet).toHaveBeenCalledWith("worker:simulation_mode");
    expect(result).toBe(false);
  });

  it("should default to false if Redis returns null", async () => {
    mockRedisGet.mockResolvedValue(null);
    const result = await SimulationManager.isSimulationEnabled();
    expect(mockRedisGet).toHaveBeenCalledWith("worker:simulation_mode");
    expect(result).toBe(false);
  });
});
