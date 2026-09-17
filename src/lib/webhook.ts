import { createHmac, timingSafeEqual } from "node:crypto";
import type { CommentEvent, MessageEvent } from "./types";

/** Verifies the X-Hub-Signature-256 header Meta sends with every webhook POST. */
export function verifySignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader || !appSecret) return false;
  const [algo, theirs] = signatureHeader.split("=");
  if (algo !== "sha256" || !theirs) return false;
  const ours = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  if (ours.length !== theirs.length) return false;
  return timingSafeEqual(Buffer.from(ours, "hex"), Buffer.from(theirs, "hex"));
}

/** Handles the one-time GET verification Meta performs when you save the webhook URL. */
export function handleVerification(params: URLSearchParams, verifyToken: string): { ok: true; challenge: string } | { ok: false } {
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (mode === "subscribe" && verifyToken && token === verifyToken && challenge) {
    return { ok: true, challenge };
  }
  return { ok: false };
}

interface WebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    messaging?: Array<{
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
        quick_reply?: { payload?: string };
        reply_to?: { story?: { id?: string; url?: string } };
        attachments?: Array<{ type?: string; payload?: { url?: string } }>;
      };
      postback?: { mid?: string; title?: string; payload?: string };
    }>;
    changes?: Array<{
      field?: string;
      value?: {
        id?: string;
        text?: string;
        parent_id?: string;
        from?: { id?: string; username?: string };
        media?: { id?: string; media_product_type?: string };
      };
    }>;
  }>;
}

/** Extracts comment events from a webhook payload, ignoring anything that is not a comment. */
export function parseCommentEvents(payload: unknown): CommentEvent[] {
  const body = payload as WebhookPayload;
  if (!body || body.object !== "instagram" || !Array.isArray(body.entry)) return [];

  const events: CommentEvent[] = [];
  for (const entry of body.entry) {
    if (!entry?.id || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (change?.field !== "comments") continue;
      const v = change.value;
      if (!v?.id || !v.from?.id || !v.media?.id) continue;
      events.push({
        igUserId: String(entry.id),
        commentId: String(v.id),
        text: v.text ?? "",
        fromId: String(v.from.id),
        fromUsername: v.from.username ?? "",
        mediaId: String(v.media.id),
        mediaProductType: v.media.media_product_type ?? null,
        parentId: v.parent_id ? String(v.parent_id) : null,
        time: typeof entry.time === "number" ? entry.time : Math.floor(Date.now() / 1000),
      });
    }
  }
  return events;
}

/** Extracts inbound DMs from a webhook payload. Echoes of our own messages are ignored. */
export function parseMessageEvents(payload: unknown): MessageEvent[] {
  const body = payload as WebhookPayload;
  if (!body || body.object !== "instagram" || !Array.isArray(body.entry)) return [];

  const events: MessageEvent[] = [];
  for (const entry of body.entry) {
    if (!entry?.id || !Array.isArray(entry.messaging)) continue;
    for (const m of entry.messaging) {
      if (!m?.sender?.id) continue;
      if (m.sender.id === String(entry.id)) continue;
      const timestamp = typeof m.timestamp === "number" ? m.timestamp : Date.now();
      if (m.postback?.payload) {
        events.push({
          igUserId: String(entry.id),
          senderId: String(m.sender.id),
          messageId: String(m.postback.mid ?? `postback-${m.sender.id}-${timestamp}`),
          text: m.postback.title ?? "",
          payload: String(m.postback.payload),
          storyReplyId: null,
          storyMention: false,
          timestamp,
        });
        continue;
      }
      if (!m.message?.mid || m.message.is_echo) continue;
      const storyMention = (m.message.attachments ?? []).some((a) => a?.type === "story_mention");
      events.push({
        igUserId: String(entry.id),
        senderId: String(m.sender.id),
        messageId: String(m.message.mid),
        text: m.message.text ?? "",
        payload: m.message.quick_reply?.payload ? String(m.message.quick_reply.payload) : null,
        storyReplyId: m.message.reply_to?.story?.id ? String(m.message.reply_to.story.id) : null,
        storyMention,
        timestamp,
      });
    }
  }
  return events;
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** Pulls the first email address out of free text, or null. */
export function extractEmail(text: string): string | null {
  const match = text.match(EMAIL_PATTERN);
  return match ? match[0].toLowerCase().replace(/[.,;:!?]+$/, "") : null;
}

/** "yes", "yes please!!", "sure", "send it", "ok" ... */
const YES_PATTERN = /^[^\p{L}\p{N}]*(y+e+s+|yea+h*|yep|yup|sure|ok(ay)?|please|send( it| me)?|i want it|absolutely|definitely|👍|✅|🙌|💌|❤️|🙏)(?![\p{L}\p{N}])/iu;
/** A soft no: "no", "no thanks", "nope", "not interested". Can be reopened if they change their mind. */
const NO_PATTERN = /^[^\p{L}\p{N}]*(no+( thanks| thank you| ty)?|nope|nah|not interested|not now|maybe later)(?![\p{L}\p{N}])/iu;
/** A hard stop: never message again, whatever they say afterwards. */
const STOP_PATTERN = /^[^\p{L}\p{N}]*(stop|unsubscribe|cancel|opt out|leave me alone|don'?t (message|dm|text|contact)|go away|block)(?![\p{L}\p{N}])/iu;
/** "wait", "oops", "actually yes", "changed my mind", "I meant yes" ... */
const CHANGED_MIND_PATTERN = /\b(wait|oops|whoops|sorry|actually|accident|by mistake|changed my mind|meant (to|yes)|do want|i want|can i still|still (want|get)|send it)\b/iu;

export function looksLikeYes(text: string): boolean {
  return YES_PATTERN.test(text.trim());
}

/** Soft no or hard stop. */
export function looksLikeNo(text: string): boolean {
  const t = text.trim();
  return NO_PATTERN.test(t) || STOP_PATTERN.test(t);
}

export function looksLikeStop(text: string): boolean {
  return STOP_PATTERN.test(text.trim());
}

/** After a decline: does this message read as "oops, I do want it"? */
export function looksLikeChangedMind(text: string): boolean {
  const t = text.trim();
  if (looksLikeNo(t)) return false;
  return looksLikeYes(t) || CHANGED_MIND_PATTERN.test(t);
}
