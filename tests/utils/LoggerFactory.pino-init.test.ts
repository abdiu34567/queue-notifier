jest.mock("pino", () => {
  const mockRoot = {
    info: jest.fn(),
    child: jest.fn().mockReturnThis(),
    level: "info",
  };
  const fn = jest.fn(() => mockRoot) as any;
  fn.stdTimeFunctions = { isoTime: () => "timestamp" };
  return { __esModule: true, default: fn };
});

describe("Pino constructor invocation", () => {
  it("calls pino() exactly once with the defaultOptions", () => {
    const pinoModule = require("pino");
    const pinoMock = pinoModule.default as jest.Mock;
    require("../../src/utils/LoggerFactory");

    expect(pinoMock).toHaveBeenCalledTimes(1);
    const opts = pinoMock.mock.calls[0][0];
    expect(opts).toHaveProperty("level");
    expect(opts).toHaveProperty("formatters");
    expect(opts.formatters).toHaveProperty("level");
  });
});
