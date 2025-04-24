import { Logger as PinoLogger, Level } from "pino";

// --- Mock Implementation ---
// Create a single Jest mock function that all log levels will call.
// This makes it easy to assert on ANY log call or specific ones.
const mockLogFn = jest.fn();

// --- Factory Function ---
// Creates an object that looks like a Pino logger but calls our mock function.
export const createMockLogger = (level: Level = "info"): PinoLogger => {
  const logger = {
    level: level,
    fatal: mockLogFn,
    error: mockLogFn,
    warn: mockLogFn,
    info: mockLogFn,
    debug: mockLogFn,
    trace: mockLogFn,
    silent: jest.fn(),

    child: jest.fn().mockImplementation((bindings) => {
      return logger;
    }),

    setBindings: jest.fn((bindings) => {}),
  } as unknown as PinoLogger;

  return logger;
};

export const clearMockLogger = () => {
  mockLogFn.mockClear();
};

export const mockLoggerFn = mockLogFn;
