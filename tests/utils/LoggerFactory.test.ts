const mockChildLogger = {
  info: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
  level: "info",
};
const mockRootLogger = {
  ...mockChildLogger,
  child: jest.fn().mockReturnValue(mockChildLogger),
  info: jest.fn(),
  level: "info",
};

const constPinoMock = jest.fn(() => mockRootLogger) as any;
const constCommon = { stdTimeFunctions: { isoTime: jest.fn() } };
Object.assign(constPinoMock, constCommon);

jest.mock("pino", () => ({
  __esModule: true,
  default: constPinoMock,
}));

import pino from "pino";
import { loggerFactory } from "../../src/utils/LoggerFactory";
import type { Level, Logger } from "pino";

describe("loggerFactory", () => {
  let childLogger: Logger;

  beforeEach(() => {
    jest.clearAllMocks();
    childLogger = {
      info: jest.fn(),
      error: jest.fn(),
      child: jest.fn(),
      level: "info",
    } as any;
    (mockRootLogger.child as jest.Mock).mockReturnValue(childLogger);
  });

  it("initial getLevel returns default level from pino", () => {
    const level = loggerFactory.getLevel();
    expect(level).toBe("info");
  });

  it("setLevel updates rootLogger.level and currentLevel then logs change", () => {
    const newLevel: Level = "debug";
    loggerFactory.setLevel(newLevel);
    expect(mockRootLogger.level).toBe(newLevel);
    expect(loggerFactory.getLevel()).toBe(newLevel);
    expect(mockRootLogger.info).toHaveBeenCalledWith(
      { newLevel },
      "Root logger level set."
    );
  });

  it("createLogger returns child logger with provided context", () => {
    const context = { component: "Test" };
    const returned = loggerFactory.createLogger(context);
    expect(mockRootLogger.child).toHaveBeenCalledWith(context);
    expect(returned).toBe(childLogger);
  });

  it("createLogger returns child logger with empty context when no context provided", () => {
    const returned = loggerFactory.createLogger();
    expect(mockRootLogger.child).toHaveBeenCalledWith({});
    expect(returned).toBe(childLogger);
  });
});
