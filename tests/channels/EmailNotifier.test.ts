import { EmailNotifier } from "../../src/jobs/channels/EmailNotifier";
import nodemailer from "nodemailer";

const sendMailMock = jest
  .fn()
  .mockResolvedValue({ messageId: "mocked-message-id" });

jest.mock("nodemailer", () => ({
  createTransport: jest.fn(() => ({
    sendMail: sendMailMock,
  })),
}));

describe("EmailNotifier", () => {
  const emailConfig = {
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: "test@example.com", pass: "password" },
    from: "no-reply@example.com",
    maxEmailsPerSecond: 5,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  beforeAll(() => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it("should initialize nodemailer transporter correctly", () => {
    new EmailNotifier(emailConfig);
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: emailConfig.host,
      port: emailConfig.port,
      secure: emailConfig.secure,
      auth: emailConfig.auth,
    });
  }, 50000);

  it("should send email notifications successfully", async () => {
    const notifier = new EmailNotifier(emailConfig);
    const recipients = ["user1@example.com", "user2@example.com"];

    await expect(
      notifier.send(recipients, [
        {
          subject: "Test Subject",
          text: "Test Email Message",
        },
      ])
    ).resolves.not.toThrow();

    expect(sendMailMock).toHaveBeenCalledTimes(recipients.length);
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: emailConfig.from,
        to: expect.any(String),
        subject: "Test Subject",
      })
    );
  }, 50000);

  it("should respect rate-limiting", async () => {
    const notifier = new EmailNotifier(emailConfig);
    const manyRecipients = Array.from(
      { length: 50 },
      (_, i) => `user${i}@example.com`
    );

    await expect(
      notifier.send(manyRecipients, [
        {
          subject: "Test",
          text: "Rate Limit Test",
        },
      ])
    ).resolves.not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 2000));

    expect(sendMailMock).toHaveBeenCalled();
  }, 50000);
});
