import { env } from "./env";
import { buildDmMessage, InstagramApiError, InstagramClient } from "./instagram";
import { findAutomation, pickRandom, renderTemplate } from "./matching";
import type { Store } from "./store";
import type { ActivityRecord, Automation, CommentEvent } from "./types";

export interface RunnerDeps {
  store: Store;
  /** Builds an API client for the account that received the comment. */
  clientFor: (igUserId: string) => Promise<InstagramClient | null>;
  random?: () => number;
  log?: (msg: string, extra?: unknown) => void;
}

/** Default client factory: uses the token stored for the account, else the env token. */
export async function defaultClientFor(store: Store, igUserId: string): Promise<InstagramClient | null> {
  const account = await store.getAccount(igUserId);
  const token = account?.accessToken || (env.igUserId === igUserId || !env.igUserId ? env.accessToken : "");
  if (!token) return null;
  return new InstagramClient(token, { apiVersion: env.apiVersion });
}

const PRIVATE_REPLY_WINDOW_SECONDS = 7 * 24 * 60 * 60;

/**
 * Processes one comment: match a rule, reply publicly, send the DM, record the outcome.
 * Never throws; every path records an activity row so the dashboard shows what happened.
 */
export async function handleCommentEvent(event: CommentEvent, deps: RunnerDeps): Promise<ActivityRecord> {
  const { store } = deps;
  const log = deps.log ?? (() => {});
  const base = {
    commentId: event.commentId,
    igUserId: event.igUserId,
    fromUsername: event.fromUsername,
    commentText: event.text,
  };

  const finish = async (record: ActivityRecord) => {
    try {
      await store.recordActivity(record);
    } catch (err) {
      log("failed to record activity", err);
    }
    return record;
  };

  // 1. Never respond to the account's own comments (including our own public replies).
  if (event.fromId === event.igUserId) {
    return finish({ ...base, automationId: null, status: "skipped", detail: "own comment" });
  }

  // 2. Idempotency: Meta may deliver the same webhook more than once.
  if (await store.hasHandled(event.commentId)) {
    return finish({ ...base, automationId: null, status: "skipped", detail: "already handled" });
  }

  // 3. Private replies are only allowed for 7 days after the comment.
  if (Math.floor(Date.now() / 1000) - event.time > PRIVATE_REPLY_WINDOW_SECONDS) {
    return finish({ ...base, automationId: null, status: "skipped", detail: "comment older than 7 days" });
  }

  // 4. Find a matching automation.
  const automations = await store.listAutomations(event.igUserId);
  const automation = findAutomation(event, automations);
  if (!automation) {
    return finish({ ...base, automationId: null, status: "skipped", detail: "no matching automation" });
  }

  const client = await deps.clientFor(event.igUserId);
  if (!client) {
    return finish({ ...base, automationId: automation.id, status: "failed", detail: "no access token for this account" });
  }

  const details: string[] = [];

  // 5. Public reply under the comment (optional).
  const publicReply = pickRandom(automation.publicReplies.filter((r) => r.trim()), deps.random);
  if (publicReply) {
    try {
      await client.replyToComment(event.commentId, renderTemplate(publicReply, { username: event.fromUsername, link: automation.dmLink ?? "" }));
      details.push("public reply posted");
    } catch (err) {
      details.push(`public reply failed: ${describeError(err)}`);
      log("public reply failed", err);
    }
  }

  // 6. The DM (private reply). This is the part that matters.
  try {
    const message = buildDmMessage(
      renderTemplate(automation.dmText, { username: event.fromUsername, link: automation.dmLink ?? "" }),
      automation.dmLink,
      automation.dmButtonTitle,
    );
    await client.sendPrivateReply(event.igUserId, event.commentId, message);
    details.push("DM sent");
    return finish({ ...base, automationId: automation.id, status: "sent", detail: details.join("; ") });
  } catch (err) {
    details.push(`DM failed: ${describeError(err)}`);
    log("DM failed", err);
    return finish({ ...base, automationId: automation.id, status: "failed", detail: details.join("; ") });
  }
}

export async function handleCommentEvents(events: CommentEvent[], deps: RunnerDeps): Promise<ActivityRecord[]> {
  const results: ActivityRecord[] = [];
  for (const event of events) {
    results.push(await handleCommentEvent(event, deps));
  }
  return results;
}

function describeError(err: unknown): string {
  if (err instanceof InstagramApiError) {
    const code = [err.code, err.subcode].filter((x) => x !== undefined).join("/");
    return `${err.message}${code ? ` (code ${code})` : ""}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export type { Automation };
