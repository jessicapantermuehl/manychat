/** A single "comment → DM" rule, the equivalent of a ManyChat comment-growth-tool automation. */
export interface Automation {
  id: string;
  /** Human-readable name shown in the dashboard. */
  name: string;
  /** Instagram user id (the account that owns the media). */
  igUserId: string;
  /** Media (post/reel) id this rule applies to. Empty = every post on the account. */
  mediaId: string | null;
  /**
   * Keywords that trigger the automation. Empty array = trigger on any comment.
   * Matching is case-insensitive and ignores punctuation / emoji around the word.
   */
  keywords: string[];
  /** How to match keywords: "contains" (anywhere in the comment) or "exact" (whole comment). */
  matchMode: "contains" | "exact";
  /**
   * Public replies posted under the comment. One is picked at random so replies
   * look natural. Empty = do not reply publicly.
   */
  publicReplies: string[];
  /** The DM text. May contain {{username}} and {{link}} placeholders. */
  dmText: string;
  /** Optional link included in the DM (as a button when dmButtonTitle is set, otherwise in text). */
  dmLink: string | null;
  /** Optional button title. If set together with dmLink, the DM is sent as a button template. */
  dmButtonTitle: string | null;
  /** Ignore comments that are replies to other comments. */
  ignoreReplies: boolean;
  /**
   * When true (recommended), the private reply only asks whether they want the resource, with
   * Yes / No buttons. The link (or the email question) is sent after they tap Yes. This keeps
   * the account inside Meta's messaging rules: a private reply is one message, and the 24-hour
   * window that allows further messages opens only after the person interacts.
   */
  requireOptIn: boolean;
  /** The opt-in question. Supports {{username}}. */
  optInPrompt: string;
  /** Title of the Yes button, at most 20 characters. */
  optInButton: string;
  /**
   * When true the first DM asks for an email address instead of sending the link.
   * Once the person replies with an email, it is pushed to GoHighLevel and dmText (with the link) is sent.
   */
  collectEmail: boolean;
  /** The DM that asks for the email. Supports {{username}}. */
  emailPrompt: string;
  /** Sent once if the reply did not contain an email address. */
  emailRetryText: string;
  /** Tags added to the GoHighLevel contact. */
  ghlTags: string[];
  /**
   * Plain-English description of what a commenter is asking for when this rule should fire,
   * e.g. "someone asking for the gut health guide". Empty = keyword matching only.
   */
  intentDescription: string;
  /** FAQ text the AI may answer from while waiting for the email. Empty = no AI answers. */
  aiFaq: string;
  /** Whether the rule is live. */
  active: boolean;
  createdAt?: string;
}

/** Normalised representation of one incoming comment from the webhook. */
export interface CommentEvent {
  /** IG user id of the account that received the comment (entry.id). */
  igUserId: string;
  commentId: string;
  text: string;
  fromId: string;
  fromUsername: string;
  mediaId: string;
  mediaProductType: string | null;
  /** Set when the comment is itself a reply to another comment. */
  parentId: string | null;
  /** Unix timestamp in seconds from the webhook entry. */
  time: number;
}

/** One inbound DM from the messages webhook. */
export interface MessageEvent {
  /** IG user id of the account that received the message (entry.id). */
  igUserId: string;
  /** Instagram-scoped id of the person who sent it. */
  senderId: string;
  messageId: string;
  text: string;
  /** Payload of a tapped quick reply or postback button, when the message was a tap. */
  payload: string | null;
  /** Unix timestamp in milliseconds from the webhook. */
  timestamp: number;
}

export type ConversationState = "awaiting_optin" | "awaiting_email" | "done" | "abandoned";

/** Tracks an email-capture conversation with one person. */
export interface Conversation {
  igUserId: string;
  /** Instagram-scoped id used for messaging. */
  igsid: string;
  username: string;
  automationId: string;
  commentId: string;
  state: ConversationState;
  /** How many times we have asked for the email (prompt + retries). */
  attempts: number;
  email: string | null;
  ghlContactId: string | null;
  /** Last inbound message id we acted on, so a redelivered webhook is ignored. */
  lastMessageId?: string | null;
  /** Why the conversation closed. "declined" (a soft no) can be reopened once; "stopped" never. */
  closedReason?: "declined" | "stopped" | "expired" | "no_response" | "error" | null;
  /** True once we have re-sent the opt-in question after a change of mind. */
  reopened?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type EventStatus = "sent" | "skipped" | "failed" | "captured";

export interface ActivityRecord {
  id?: string;
  commentId: string;
  igUserId: string;
  automationId: string | null;
  fromUsername: string;
  commentText: string;
  status: EventStatus;
  detail: string;
  /** AI triage label, when AI is enabled. */
  category?: string | null;
  /** AI-drafted reply the owner could post by hand. */
  suggestedReply?: string | null;
  createdAt?: string;
}

/** Per-account settings used by the AI features. */
export interface AccountSettings {
  igUserId: string;
  voiceSamples: string;
  brandNotes: string;
}

export interface IgAccount {
  igUserId: string;
  username: string;
  accessToken: string;
  /** ISO timestamp when the long-lived token expires. */
  tokenExpiresAt: string | null;
}
