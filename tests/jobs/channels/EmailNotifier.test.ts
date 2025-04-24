const dummyLogFn = () => {};
const dummyLogger = {
  fatal: dummyLogFn,
  error: dummyLogFn,
  warn: dummyLogFn,
  info: dummyLogFn,
  debug: dummyLogFn,
  trace: dummyLogFn,
  child: jest.fn().mockImplementation(() => dummyLogger),
  setBindings: jest.fn(),
} as any;
jest.mock("../../../src/utils/LoggerFactory", () => ({
  loggerFactory: { createLogger: jest.fn().mockReturnValue(dummyLogger) },
}));

const mockSendMail = jest.fn();
const mockTransporterClose = jest.fn();
const mockCreateTransport = jest.fn().mockReturnValue({
  sendMail: mockSendMail,
  close: mockTransporterClose,
});
jest.mock("nodemailer", () => ({
  createTransport: mockCreateTransport,
}));

const mockSchedule = jest.fn().mockImplementation(async (fn) => await fn());
jest.mock("../../../src/core/RateLimiter", () => ({
  RateLimiter: jest.fn().mockImplementation(() => ({
    schedule: mockSchedule,
  })),
}));
const MockedRateLimiter = jest.requireMock(
  "../../../src/core/RateLimiter"
).RateLimiter;

const mockBatchSenderProcess = jest.fn();
jest.mock("../../../src/core/BatchSender", () => ({
  batchSender: {
    process: mockBatchSenderProcess,
  },
}));

import { EmailNotifier } from "../../../src/jobs/channels/EmailNotifier";
import {
  EmailMeta,
  NotificationResult,
} from "../../../src/jobs/channels/NotificationChannel";

describe("EmailNotifier", () => {
  const baseConfig = {
    host: "smtp.test.com",
    port: 587,
    secure: false,
    auth: { user: "user", pass: "pass" },
    from: "from@test.com",
    maxEmailsPerSecond: 15,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMail.mockResolvedValue({
      messageId: "test-message-id",
      accepted: ["test@example.com"],
      rejected: [],
    });
    mockBatchSenderProcess.mockImplementation(
      async (recipients, meta, limiter, sendFn, logger, options) => {
        const results: NotificationResult[] = [];
        for (let i = 0; i < recipients.length; i++) {
          results.push(
            await sendFn(
              recipients[i],
              meta[i],
              logger.child({ recipient: recipients[i] })
            )
          );
        }
        return results;
      }
    );
  });

  test("constructor should create transporter and rate limiter", () => {
    const notifier = new EmailNotifier(baseConfig);

    expect(mockCreateTransport).toHaveBeenCalledTimes(1);
    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: baseConfig.host,
      port: baseConfig.port,
      secure: baseConfig.secure,
      auth: baseConfig.auth,
      pool: true,
      maxConnections: 5,
    });
    expect(MockedRateLimiter).toHaveBeenCalledTimes(1);
    expect(MockedRateLimiter).toHaveBeenCalledWith(
      baseConfig.maxEmailsPerSecond,
      1000
    );
  });

  test("constructor should use default rate limit if not provided", () => {
    const configWithoutRate: Omit<typeof baseConfig, "maxEmailsPerSecond"> = {
      host: baseConfig.host,
      port: baseConfig.port,
      secure: baseConfig.secure,
      auth: baseConfig.auth,
      from: baseConfig.from,
    };

    const notifier = new EmailNotifier(configWithoutRate as any);

    expect(MockedRateLimiter).toHaveBeenCalledTimes(1);
    expect(MockedRateLimiter).toHaveBeenCalledWith(10, 1000);
  });

  test("constructor should throw if transporter creation fails", () => {
    const createError = new Error("Invalid credentials");
    mockCreateTransport.mockImplementationOnce(() => {
      throw createError;
    });

    expect(() => new EmailNotifier(baseConfig)).toThrow(
      `Failed to create Nodemailer transporter: ${createError.message}`
    );
  });

  test("send should call batchSender.process with correct arguments", async () => {
    const notifier = new EmailNotifier(baseConfig);
    const emails = ["test1@example.com", "test2@example.com"];
    const meta: EmailMeta[] = [{ subject: "Sub1" }, { subject: "Sub2" }];

    await notifier.send(emails, meta, dummyLogger);

    expect(mockBatchSenderProcess).toHaveBeenCalledTimes(1);
    expect(mockBatchSenderProcess).toHaveBeenCalledWith(
      emails,
      meta,
      expect.any(Object),
      expect.any(Function),
      dummyLogger,
      { concurrency: 3 }
    );
    expect(mockBatchSenderProcess.mock.calls[0][3].name).toContain(
      "_sendSingleEmail"
    );
  });

  test("_sendSingleEmail should call transporter.sendMail and return success", async () => {
    const notifier = new EmailNotifier(baseConfig);
    const email = "recipient@test.com";
    const emailMeta: EmailMeta = { subject: "Test Subject", text: "Test Body" };
    const mockMessageInfo = {
      messageId: "test-msg-123",
      accepted: [email],
      rejected: [],
    };
    mockSendMail.mockResolvedValueOnce(mockMessageInfo);

    const result = await (notifier as any)._sendSingleEmail(
      email,
      emailMeta,
      dummyLogger.child({ recipient: email })
    );

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith({
      from: baseConfig.from,
      to: email,
      subject: emailMeta.subject,
      text: emailMeta.text,
    });
    expect(result).toEqual({
      status: "success",
      recipient: email,
      response: expect.objectContaining({ messageId: "test-msg-123" }),
    });
  });

  test("_sendSingleEmail should use HTML if provided", async () => {
    const notifier = new EmailNotifier(baseConfig);
    const email = "recipient@test.com";
    const emailMeta: EmailMeta = {
      subject: "HTML Test",
      html: "<p>Test HTML</p>",
      text: "Fallback text",
    };
    mockSendMail.mockResolvedValueOnce({
      messageId: "html-id",
      accepted: [email],
    });

    await (notifier as any)._sendSingleEmail(
      email,
      emailMeta,
      dummyLogger.child({ recipient: email })
    );

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: emailMeta.html,
      })
    );

    const actualOptions = mockSendMail.mock.calls[0][0];
    expect(actualOptions).toHaveProperty("html", emailMeta.html);
    expect(actualOptions).not.toHaveProperty("text");
  });

  test("_sendSingleEmail should return error if sendMail fails", async () => {
    const notifier = new EmailNotifier(baseConfig);
    const email = "fail@test.com";
    const emailMeta: EmailMeta = { subject: "Test Subject" };
    const sendError = new Error("Invalid recipient");
    (sendError as any).code = "EENVELOPE";
    (sendError as any).responseCode = 550;
    mockSendMail.mockRejectedValueOnce(sendError);

    const result = await (notifier as any)._sendSingleEmail(
      email,
      emailMeta,
      dummyLogger.child({ recipient: email })
    );

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: "error",
      recipient: email,
      error: expect.stringMatching(/^550:Invalid_recipient$/),
      response: expect.objectContaining({
        message: "Invalid recipient",
        code: "EENVELOPE",
        statusCode: 550,
      }),
    });
  });

  test("_sendSingleEmail should return error if meta is missing subject", async () => {
    const notifier = new EmailNotifier(baseConfig);
    const email = "no-subject@test.com";
    const emailMeta = { text: "Body only" } as EmailMeta;

    const result = await (notifier as any)._sendSingleEmail(
      email,
      emailMeta,
      dummyLogger.child({ recipient: email })
    );

    expect(mockSendMail).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "error",
      recipient: email,
      error: "MISSING_SUBJECT",
    });
  });

  test("close should call transporter.close", async () => {
    const notifier = new EmailNotifier(baseConfig);
    await notifier.close(dummyLogger);
    expect(mockTransporterClose).toHaveBeenCalledTimes(1);
  });
});
