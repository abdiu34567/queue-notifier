import Redis, { RedisOptions } from "ioredis";
import { Logger as PinoLogger } from "pino"; // Import Pino type

/**
 * Ensures a valid ioredis instance is available, configured correctly for BullMQ.
 * Either validates a provided instance or creates a new one from options.
 *
 * @param connection - The user-provided Redis instance or connection options.
 * @param logger - The Pino logger instance to use for logging warnings/errors.
 * @returns A correctly configured Redis instance.
 * @throws {Error} If the provided instance/options are invalid or misconfigured (for required settings).
 */
export function ensureRedisInstance(
  connection: Redis | RedisOptions,
  logger: PinoLogger
): Redis {
  const setupLogger = logger.child({ component: "RedisSetup" });

  if (connection instanceof Redis) {
    setupLogger.debug("Validating provided Redis instance...");
    const options = connection.options;
    let isValid = true;

    if (options?.maxRetriesPerRequest !== null) {
      const errMsg =
        "Provided Redis instance must be configured with maxRetriesPerRequest: null for BullMQ compatibility.";
      setupLogger.error(
        { currentValue: options?.maxRetriesPerRequest },
        errMsg
      );
      isValid = false;
      throw new Error(errMsg);
    }
    if (
      options?.enableReadyCheck !== false &&
      options?.enableReadyCheck !== undefined
    ) {
      // BullMQ generally recommends disabling readyCheck
      setupLogger.warn(
        { currentValue: options?.enableReadyCheck },
        "Provided Redis instance does not have 'enableReadyCheck: false'. Recommended for BullMQ."
      );
    }

    if (isValid) {
      setupLogger.info("Provided Redis instance validated successfully.");
    }
    return connection;
  }

  if (typeof connection === "object" && connection !== null) {
    setupLogger.debug("Creating new Redis instance from options...");
    const optionsWithDefaults: RedisOptions = {
      ...connection,
      maxRetriesPerRequest: null,
      enableReadyCheck:
        connection.enableReadyCheck === undefined
          ? false
          : connection.enableReadyCheck,
    };
    try {
      setupLogger.info(
        {
          options: {
            maxRetriesPerRequest: null,
            enableReadyCheck: optionsWithDefaults.enableReadyCheck,
          },
        },
        "Creating new Redis instance with BullMQ defaults."
      );
      const newInstance = new Redis(optionsWithDefaults);
      setupLogger.debug("New Redis instance created successfully.");
      return newInstance;
    } catch (e: any) {
      setupLogger.error(
        { err: e, providedOptions: connection },
        "Failed to create Redis instance from options."
      );
      throw new Error(`Failed to create Redis instance: ${e.message || e}`);
    }
  }

  const err = new Error(
    "Invalid redisConnection provided: Must be an ioredis instance or RedisOptions object."
  );
  setupLogger.error({ providedType: typeof connection }, err.message);
  throw err;
}
