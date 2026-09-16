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
      message?: { mid?: string; text?: string; is_echo?: boolean };
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
      if (!m?.sender?.id || !m.message?.mid) continue;
      if (m.message.is_echo) continue;
      if (m.sender.id === String(entry.id)) continue;
      events.push({
        igUserId: String(entry.id),
        senderId: String(m.sender.id),
        messageId: String(m.message.mid),
        text: m.message.text ?? "",
        timestamp: typeof m.timestamp === "number" ? m.timestamp : Date.now(),
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
