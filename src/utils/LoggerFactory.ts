import pino, { LoggerOptions, Logger, Level } from "pino";

// --- Configuration ---
// Base options applicable in all modes
const baseOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL || "info",
  formatters: { level: (label) => ({ level: label }) },
  timestamp: pino.stdTimeFunctions.isoTime,
};

let finalPinoOptions: LoggerOptions = { ...baseOptions };

// Check for non-production environment
if (process.env.NODE_ENV !== "production") {
  let pinoPrettyInstalled = false;
  try {
    // Attempt to resolve 'pino-pretty'. This will throw if not found
    // relative to the *running application's* node_modules.
    require.resolve("pino-pretty");
    pinoPrettyInstalled = true;
  } catch (e) {
    // pino-pretty not found where require.resolve looks
    pinoPrettyInstalled = false;
  }

  if (pinoPrettyInstalled) {
    // Development mode AND pino-pretty is installed, configure transport
    console.log(
      "[LoggerFactory] Development environment: Found pino-pretty, enabling formatted logs."
    );
    finalPinoOptions.transport = {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
        ignore: "pid,hostname", // Keep relevant context like component, queue, jobId etc.
      },
    };
  } else {
    // Development mode BUT pino-pretty is NOT installed
    console.warn(
      '[LoggerFactory] Development environment: pino-pretty not found. Outputting JSON logs. For formatted logs, run "npm install --save-dev pino-pretty" or "yarn add --dev pino-pretty" in your project and restart.'
    );
    // No transport added, will default to JSON specified by baseOptions
  }
} else {
  // Production mode
}

// --- Initialization ---
let rootLogger: Logger;
try {
  rootLogger = pino(finalPinoOptions);
  // Inside the final catch block in LoggerFactory.ts
} catch (finalErr) {
  // If even basic pino init fails, something is very wrong. Fallback to console.
  console.error(
    "[LoggerFactory] CRITICAL: Failed to initialize Pino logger even with base options. Using basic console.",
    finalErr
  );

  // --- Improved Fallback Logger ---
  const createFallbackLog = (level: string) => {
    // Choose the appropriate console method based on level
    const consoleMethod =
      level === "fatal"
        ? console.error // Treat fatal like error
        : level === "error"
        ? console.error
        : level === "warn"
        ? console.warn
        : level === "debug"
        ? console.debug // Or console.log if debug not styled
        : level === "trace"
        ? console.debug // Or console.log
        : console.info; // Default to info (includes 'info')

    return (...args: any[]) => {
      // Format closer to pino-pretty's minimal output (optional)
      const timestamp = new Date().toISOString(); // Simple timestamp
      const levelStr = `[${level.toUpperCase()}]`.padEnd(7); // Pad for alignment
      const context =
        typeof args[0] === "object" && args[0] !== null ? args.shift() : {}; // Extract optional context obj
      const message = args.shift() || ""; // Extract message

      consoleMethod(`${timestamp} ${levelStr}: ${message}`, context, ...args); // Log with level, msg, context, rest
    };
  };

  rootLogger = {
    fatal: createFallbackLog("fatal"),
    error: createFallbackLog("error"),
    warn: createFallbackLog("warn"),
    info: createFallbackLog("info"),
    debug: createFallbackLog("debug"),
    trace: createFallbackLog("trace"),
    silent: () => {},
    level: "info", // Default level for the fallback
    // Fallback child/setBindings can just return the same logger
    child: () => rootLogger,
    setBindings: () => {},
  } as unknown as Logger;
  // --- End Improved Fallback Logger ---
}

let currentLevel: Level = rootLogger.level as Level;

export const loggerFactory = {
  setLevel: (level: Level): void => {
    rootLogger.level = level;
    currentLevel = level;
    rootLogger.info({ newLevel: level }, `Root logger level set.`);
  },
  getLevel: (): Level => {
    return currentLevel;
  },
  createLogger: (context?: Record<string, any>): Logger => {
    return rootLogger.child(context || {});
  },
};
