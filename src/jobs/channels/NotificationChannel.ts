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
import https = require("https");

export interface NotificationChannel {
  send(
    userIds: string[],
    meta?: Record<string, any>
  ): Promise<
    { status: string; recipient: string; response?: any; error?: string }[]
  >;
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
  data?: Record<string, string>;
  dryRun?: boolean; // Enable dry-run testing mode
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
  agent?: https.Agent | undefined;
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
