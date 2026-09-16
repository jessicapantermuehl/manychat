import { createHmac, timingSafeEqual } from "node:crypto";
import type { CommentEvent } from "./types";

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
