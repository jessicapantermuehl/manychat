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

export type EventStatus = "sent" | "skipped" | "failed";

export interface ActivityRecord {
  id?: string;
  commentId: string;
  igUserId: string;
  automationId: string | null;
  fromUsername: string;
  commentText: string;
  status: EventStatus;
  detail: string;
  createdAt?: string;
}

export interface IgAccount {
  igUserId: string;
  username: string;
  accessToken: string;
  /** ISO timestamp when the long-lived token expires. */
  tokenExpiresAt: string | null;
}
