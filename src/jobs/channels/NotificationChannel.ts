import DKIM from "nodemailer/lib/dkim";
import {
  Address,
  AmpAttachment,
  Attachment,
  AttachmentLike,
  Envelope,
  IcalAttachment,
  ListHeaders,
  TextEncoding,
} from "nodemailer/lib/mailer";
import MimeNode from "nodemailer/lib/mime-node";
import { Readable } from "nodemailer/lib/xoauth2";
import {
  ForceReply,
  InlineKeyboardMarkup,
  LinkPreviewOptions,
  MessageEntity,
  ParseMode,
  ReplyKeyboardMarkup,
  ReplyKeyboardRemove,
  ReplyParameters,
} from "telegraf/typings/core/types/typegram";
import { ContentEncoding, HttpsProxyAgentOptions, Urgency } from "web-push";
import { Message } from "firebase-admin/lib/messaging/messaging-api";

import { Logger as PinoLogger } from "pino";
import { messaging } from "firebase-admin";

export interface NotificationChannel {
  /**
   * Sends the notification.
   * @param recipients Array of recipient identifiers.
   * @param meta Metadata specific to the channel.
   * @param logger A PinoLogger instance for contextual logging. // <-- Document param
   * @returns Promise resolving to an array of results.
   */
  send(
    recipients: string[],
    meta: any,
    logger: PinoLogger
  ): Promise<NotificationResult[]>;
}

export interface EmailMeta {
  subject: string;
  text?: string;
  html?: string;
  attachments?: any[];
}
export interface NotificationResult {
  status: "success" | "error";
  recipient: string;
  response?: any;
  error?: string;
}

// --- Specific Meta Type Definitions ---

/**
 * Metadata structure specifically for Firebase (FCM) notifications.
 * Allows defining standard notification fields, data payloads,
 * and platform-specific overrides.
 */
export interface FirebaseMeta {
  /** Optional top-level title, used if notification object is not provided */
  title?: string;
  /** Optional top-level body, used if notification object is not provided */
  body?: string;

  /**
   * The main notification content (title, body, image).
   * See: https://firebase.google.com/docs/reference/admin/node/firebase-admin.messaging.notification
   */
  notification?: messaging.Notification; // Use the official type

  /**
   * Custom key-value data payload. All values must be strings.
   * See: https://firebase.google.com/docs/cloud-messaging/concept-options#data_messages
   */
  data?: { [key: string]: string };

  /**
   * Android-specific configuration overrides.
   * See: https://firebase.google.com/docs/reference/admin/node/firebase-admin.messaging.androidconfig
   */
  android?: messaging.AndroidConfig;

  /**
   * Apple Push Notification Service (APNs)-specific configuration overrides.
   * See: https://firebase.google.com/docs/reference/admin/node/firebase-admin.messaging.apnsconfig
   */
  apns?: messaging.ApnsConfig;

  /**
   * Web push-specific configuration overrides.
   * See: https://firebase.google.com/docs/reference/admin/node/firebase-admin.messaging.webpushconfig
   */
  webpush?: messaging.WebpushConfig;

  /**
   * Platform-independent options for FCM messages.
   * See: https://firebase.google.com/docs/reference/admin/node/firebase-admin.messaging.fcmoptions
   */
  fcmOptions?: messaging.FcmOptions;
}

// --- Other Meta Types ---
export interface EmailMeta {
  subject: string;
  text?: string;
  html?: string;
  attachments?: any[];
}
export interface TelegramMeta extends ExtraReplyMessage {
  text: string;
  parse_mode?: "HTML" | "MarkdownV2";
}
export interface WebPushMeta {
  title: string;
  body: string;
  icon?: string;
  image?: string;
  badge?: string;
  data?: any;
  TTL?: number;
  headers?: Record<string, string>;
}

export type ExtraReplyMessage = {
  text: string;
  message_thread_id?: number | undefined;
  parse_mode?: ParseMode | undefined;
  entities?: MessageEntity[] | undefined;
  link_preview_options?: LinkPreviewOptions | undefined;
  disable_notification?: boolean | undefined;
  protect_content?: boolean | undefined;
  reply_parameters?: ReplyParameters | undefined;
  reply_markup?:
    | (
        | InlineKeyboardMarkup
        | ReplyKeyboardMarkup
        | ReplyKeyboardRemove
        | ForceReply
      )
    | undefined;
};

export interface MailOptions1 {
  from?: string | Address | undefined;
  to?: string | Address | Array<string | Address> | undefined;
}

export interface MailOptions {
  sender?: string | Address | undefined;
  cc?: string | Address | Array<string | Address> | undefined;
  bcc?: string | Address | Array<string | Address> | undefined;
  replyTo?: string | Address | Array<string | Address> | undefined;
  inReplyTo?: string | Address | undefined;
  references?: string | string[] | undefined;
  subject?: string | undefined;
  text?: string | Buffer | Readable | AttachmentLike | undefined;
  html?: string | Buffer | Readable | AttachmentLike | undefined;
  watchHtml?: string | Buffer | Readable | AttachmentLike | undefined;
  amp?: string | Buffer | Readable | AmpAttachment | undefined;
  icalEvent?: string | Buffer | Readable | IcalAttachment | undefined;
  headers?: Headers | undefined;
  list?: ListHeaders | undefined;
  attachments?: Attachment[] | undefined;
  alternatives?: Attachment[] | undefined;
  envelope?: Envelope | MimeNode.Envelope | undefined;
  messageId?: string | undefined;
  date?: Date | string | undefined;
  encoding?: string | undefined;
  raw?: string | Buffer | Readable | AttachmentLike | undefined;
  textEncoding?: TextEncoding | undefined;
  disableUrlAccess?: boolean | undefined;
  disableFileAccess?: boolean | undefined;
  dkim?: DKIM.Options | undefined;
  normalizeHeaderKey?(key: string): string;
  priority?: "high" | "normal" | "low" | undefined;
  attachDataUrls?: boolean | undefined;
}

export interface FirebaseNotificationOptions {
  title?: string;
  body?: string;
  data?: { [key: string]: string };

  notification?: Message["notification"];
  android?: Message["android"];
  apns?: Message["apns"];
  webpush?: Message["webpush"];
  fcmOptions?: Message["fcmOptions"];
}

export interface RequestOptions {
  gcmAPIKey?: string | undefined;
  vapidDetails?:
    | {
        subject: string;
        publicKey: string;
        privateKey: string;
      }
    | undefined;
  timeout?: number | undefined;
  TTL?: number | undefined;
  headers?: Headers | undefined;
  contentEncoding?: ContentEncoding | undefined;
  urgency?: Urgency | undefined;
  topic?: string | undefined;
  proxy?: string | HttpsProxyAgentOptions | undefined;
}

export interface WebPush extends RequestOptions {
  title?: string;
  body?: string;
  data?: Record<string, string>;
}

export type NotificationMeta<T = any> = {
  [K in keyof RequiredMeta]: RequiredMeta[K] | ((user: T) => RequiredMeta[K]);
};

export type RequiredMeta = {
  telegram: ExtraReplyMessage;
  email: MailOptions;
  firebase: FirebaseNotificationOptions;
  web: WebPush;
};
