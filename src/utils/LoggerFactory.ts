import pino, { LoggerOptions, Logger, Level } from "pino";

const defaultOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL || "info",
  formatters: { level: (label) => ({ level: label }) },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(process.env.NODE_ENV !== "production" && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
        ignore: "pid,hostname,component",
      },
    },
  }),
};

let rootLogger: Logger = pino(defaultOptions);
let currentLevel: Level = defaultOptions.level as Level;

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
