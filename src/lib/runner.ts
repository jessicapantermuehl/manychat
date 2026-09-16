import { getAi, type Ai } from "./ai";
import { env, hasGhl } from "./env";
import { GhlApiError, GhlClient } from "./ghl";
import { buildDmMessage, buildQuickReplyMessage, InstagramApiError, InstagramClient, type OutgoingMessage } from "./instagram";
import { eligibleAutomations, findAutomation, pickPreferred, pickRandom, renderTemplate } from "./matching";
import type { Store } from "./store";
import type { ActivityRecord, Automation, CommentEvent, Conversation, MessageEvent } from "./types";
import { extractEmail, looksLikeNo, looksLikeYes } from "./webhook";

export interface RunnerDeps {
  store: Store;
  /** Builds an API client for the account that received the comment. */
  clientFor: (igUserId: string) => Promise<InstagramClient | null>;
  /** Builds the CRM client, or null when GoHighLevel is not configured. */
  ghlClient?: () => GhlClient | null;
  /** The AI, or null when ANTHROPIC_API_KEY is not set. */
  ai?: () => Ai | null;
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

export function defaultGhlClient(): GhlClient | null {
  return hasGhl() ? new GhlClient(env.ghlApiKey, env.ghlLocationId) : null;
}

export function defaultAi(): Ai | null {
  return getAi();
}

const PRIVATE_REPLY_WINDOW_SECONDS = 7 * 24 * 60 * 60;
/** Stop waiting for a reply after this long. */
const CONVERSATION_TTL_MS = 3 * 24 * 60 * 60 * 1000;
/** Prompt + this many retries before we give up asking for an email. */
const MAX_EMAIL_ATTEMPTS = 2;
/** How many times we ask "want it?" before going quiet. */
const MAX_OPTIN_ATTEMPTS = 2;

export const OPT_IN_YES = "CS_OPTIN_YES";
export const OPT_IN_NO = "CS_OPTIN_NO";
const DEFAULT_OPT_IN_PROMPT = "Hey {{username}}! Want me to send you the link?";
const DEFAULT_OPT_IN_BUTTON = "Yes, send it!";

function vars(username: string, automation: Automation) {
  return { username, link: automation.dmLink ?? "" };
}

function optInMessage(automation: Automation, username: string): OutgoingMessage {
  const prompt = renderTemplate(automation.optInPrompt.trim() || DEFAULT_OPT_IN_PROMPT, vars(username, automation));
  const yes = automation.optInButton.trim() || DEFAULT_OPT_IN_BUTTON;
  return buildQuickReplyMessage(prompt, [
    { title: yes, payload: OPT_IN_YES },
    { title: "No thanks", payload: OPT_IN_NO },
  ]);
}

function linkMessage(automation: Automation, username: string): OutgoingMessage {
  return buildDmMessage(renderTemplate(automation.dmText, vars(username, automation)), automation.dmLink, automation.dmButtonTitle);
}

function emailPromptMessage(automation: Automation, username: string): OutgoingMessage {
  return { text: renderTemplate(automation.emailPrompt, vars(username, automation)).slice(0, 1000) };
}

/**
 * Processes one comment: match a rule, reply publicly, send the first DM, record the outcome.
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

  // 4. Find a matching automation: keywords first, then AI intent matching as a fallback.
  const automations = await store.listAutomations(event.igUserId);
  const ai = deps.ai?.() ?? null;
  const voice = ai ? await store.getSettings(event.igUserId) : null;

  // AI triage runs for every comment so the activity log doubles as an inbox. Never blocks the flow.
  const triagePromise = ai && event.text.trim()
    ? ai.triageComment(event.text, voice).catch((err) => {
        log("triage failed", err);
        return null;
      })
    : Promise.resolve(null);
  const withTriage = async (record: ActivityRecord): Promise<ActivityRecord> => {
    const triage = await triagePromise;
    return triage ? { ...record, category: triage.category, suggestedReply: triage.suggestedReply } : record;
  };

  let automation = findAutomation(event, automations);
  let matchedBy = "keyword";
  if (!automation && ai) {
    const candidates = eligibleAutomations(event, automations).filter((a) => a.intentDescription.trim());
    if (candidates.length > 0 && event.text.trim()) {
      try {
        const id = await ai.classifyIntent(
          event.text,
          candidates.map((a) => ({ id: a.id, name: a.name, intentDescription: a.intentDescription })),
        );
        automation = pickPreferred(candidates.filter((a) => a.id === id));
        matchedBy = "intent";
      } catch (err) {
        log("intent matching failed", err);
      }
    }
  }
  if (!automation) {
    return finish(await withTriage({ ...base, automationId: null, status: "skipped", detail: "no matching automation" }));
  }
  const details: string[] = matchedBy === "intent" ? ["matched by AI intent"] : [];

  const client = await deps.clientFor(event.igUserId);
  if (!client) {
    return finish(await withTriage({ ...base, automationId: automation.id, status: "failed", detail: "no access token for this account" }));
  }

  // 5. Public reply under the comment (optional).
  const publicReply = pickRandom(automation.publicReplies.filter((r) => r.trim()), deps.random);
  if (publicReply) {
    try {
      await client.replyToComment(event.commentId, renderTemplate(publicReply, vars(event.fromUsername, automation)));
      details.push("public reply posted");
    } catch (err) {
      details.push(`public reply failed: ${describeError(err)}`);
      log("public reply failed", err);
    }
  }

  // 6. The one private reply Meta allows per comment. Three shapes, in order of preference:
  //    opt-in question with buttons (recommended) → email question → the link itself.
  try {
    let message: OutgoingMessage;
    let nextState: Conversation["state"];
    if (automation.requireOptIn) {
      message = optInMessage(automation, event.fromUsername);
      nextState = "awaiting_optin";
      details.push("asked for opt-in");
    } else if (automation.collectEmail && automation.emailPrompt.trim()) {
      message = emailPromptMessage(automation, event.fromUsername);
      nextState = "awaiting_email";
      details.push("asked for email");
    } else {
      message = linkMessage(automation, event.fromUsername);
      nextState = "done";
      details.push("DM sent");
    }

    const res = await client.sendPrivateReply(event.igUserId, event.commentId, message);
    const igsid = res?.recipient_id || event.fromId;
    await store.upsertConversation({
      igUserId: event.igUserId,
      igsid,
      username: event.fromUsername,
      automationId: automation.id,
      commentId: event.commentId,
      state: nextState,
      attempts: 1,
      email: null,
      ghlContactId: null,
      lastMessageId: null,
    });
    return finish(await withTriage({ ...base, automationId: automation.id, status: "sent", detail: details.join("; ") }));
  } catch (err) {
    details.push(`DM failed: ${describeError(err)}`);
    log("DM failed", err);
    return finish(await withTriage({ ...base, automationId: automation.id, status: "failed", detail: details.join("; ") }));
  }
}

/**
 * Processes one inbound DM or button tap. Only conversations we started are acted on; every other
 * message is ignored so the app never talks to people who did not comment first.
 */
export async function handleMessageEvent(event: MessageEvent, deps: RunnerDeps): Promise<ActivityRecord | null> {
  const { store } = deps;
  const log = deps.log ?? (() => {});

  const conversation = await store.getConversation(event.igUserId, event.senderId);
  if (!conversation) return null;
  if (conversation.state === "done" || conversation.state === "abandoned") return null;
  // Meta can redeliver a webhook; never act on the same message twice.
  if (conversation.lastMessageId && conversation.lastMessageId === event.messageId) return null;

  const base = {
    commentId: conversation.commentId,
    igUserId: event.igUserId,
    fromUsername: conversation.username,
    commentText: event.text || (event.payload ? `[tap: ${event.payload}]` : ""),
  };
  const finish = async (record: ActivityRecord) => {
    try {
      await store.recordActivity(record);
    } catch (err) {
      log("failed to record activity", err);
    }
    return record;
  };
  const save = (patch: Partial<Conversation>) => store.upsertConversation({ ...conversation, ...patch, lastMessageId: event.messageId });

  // Too old: stop listening so a message weeks later does not trigger anything.
  const startedAt = conversation.createdAt ? Date.parse(conversation.createdAt) : Date.now();
  if (Date.now() - startedAt > CONVERSATION_TTL_MS) {
    await save({ state: "abandoned" });
    return finish({ ...base, automationId: conversation.automationId, status: "skipped", detail: "conversation expired" });
  }

  // An explicit no or a stop word ends the conversation immediately, in any state.
  if (event.payload === OPT_IN_NO || (!event.payload && looksLikeNo(event.text))) {
    await save({ state: "abandoned" });
    return finish({ ...base, automationId: conversation.automationId, status: "skipped", detail: "declined; conversation closed" });
  }

  const automation = await store.getAutomation(conversation.automationId);
  const client = await deps.clientFor(event.igUserId);
  if (!automation || !client) {
    await save({ state: "abandoned" });
    return finish({ ...base, automationId: conversation.automationId, status: "failed", detail: automation ? "no access token for this account" : "automation no longer exists" });
  }

  if (conversation.state === "awaiting_optin") {
    return handleOptInReply(event, conversation, automation, client, deps, base, finish, save);
  }
  return handleEmailReply(event, conversation, automation, client, deps, base, finish, save);
}

type Finish = (r: ActivityRecord) => Promise<ActivityRecord>;
type Save = (patch: Partial<Conversation>) => Promise<void>;
type Base = Omit<ActivityRecord, "automationId" | "status" | "detail">;

async function handleOptInReply(
  event: MessageEvent,
  conversation: Conversation,
  automation: Automation,
  client: InstagramClient,
  deps: RunnerDeps,
  base: Base,
  finish: Finish,
  save: Save,
): Promise<ActivityRecord> {
  const log = deps.log ?? (() => {});
  const saidYes = event.payload === OPT_IN_YES || (!event.payload && looksLikeYes(event.text));

  if (!saidYes) {
    // Anything else: ask once more with the buttons, then go quiet.
    if (conversation.attempts >= MAX_OPTIN_ATTEMPTS) {
      await save({ state: "abandoned" });
      return finish({ ...base, automationId: automation.id, status: "skipped", detail: "no opt-in after reminder; conversation closed" });
    }
    try {
      await client.sendMessage(event.igUserId, event.senderId, optInMessage(automation, conversation.username));
      await save({ attempts: conversation.attempts + 1 });
      return finish({ ...base, automationId: automation.id, status: "sent", detail: "asked for opt-in again" });
    } catch (err) {
      log("opt-in reminder failed", err);
      return finish({ ...base, automationId: automation.id, status: "failed", detail: `opt-in reminder failed: ${describeError(err)}` });
    }
  }

  // They said yes: the 24-hour window is open. Either ask for the email or deliver the link.
  try {
    if (automation.collectEmail && automation.emailPrompt.trim()) {
      await client.sendMessage(event.igUserId, event.senderId, emailPromptMessage(automation, conversation.username));
      await save({ state: "awaiting_email", attempts: 1 });
      return finish({ ...base, automationId: automation.id, status: "sent", detail: "opted in; asked for email" });
    }
    await client.sendMessage(event.igUserId, event.senderId, linkMessage(automation, conversation.username));
    await save({ state: "done" });
    return finish({ ...base, automationId: automation.id, status: "sent", detail: "opted in; link sent" });
  } catch (err) {
    log("post-opt-in DM failed", err);
    return finish({ ...base, automationId: automation.id, status: "failed", detail: `DM after opt-in failed: ${describeError(err)}` });
  }
}

async function handleEmailReply(
  event: MessageEvent,
  conversation: Conversation,
  automation: Automation,
  client: InstagramClient,
  deps: RunnerDeps,
  base: Base,
  finish: Finish,
  save: Save,
): Promise<ActivityRecord> {
  const { store } = deps;
  const log = deps.log ?? (() => {});
  const v = vars(conversation.username, automation);
  const email = extractEmail(event.text);

  // No email in the reply: answer their question from the FAQ if we can, ask again, then give up quietly.
  if (!email) {
    const ai = deps.ai?.() ?? null;
    const faqEnabled = Boolean(ai && automation.aiFaq.trim());
    const maxAttempts = faqEnabled ? MAX_EMAIL_ATTEMPTS + 1 : MAX_EMAIL_ATTEMPTS;
    if (conversation.attempts >= maxAttempts) {
      await save({ state: "abandoned" });
      return finish({ ...base, automationId: automation.id, status: "skipped", detail: "no email after retry; conversation closed" });
    }
    const retry = automation.emailRetryText.trim() || "I didn't catch an email address. Could you send it again?";
    let answer: string | null = null;
    if (faqEnabled && ai) {
      try {
        const voice = await store.getSettings(event.igUserId);
        answer = await ai.answerFromFaq(event.text, automation.aiFaq, voice);
      } catch (err) {
        log("FAQ answer failed", err);
      }
    }
    try {
      const text = answer ? `${answer}\n\n${renderTemplate(retry, v)}` : renderTemplate(retry, v);
      await client.sendMessage(event.igUserId, event.senderId, { text: text.slice(0, 1000) });
      await save({ attempts: conversation.attempts + 1 });
      return finish({ ...base, automationId: automation.id, status: "sent", detail: answer ? "answered from FAQ and asked for email again" : "asked for email again" });
    } catch (err) {
      log("retry DM failed", err);
      return finish({ ...base, automationId: automation.id, status: "failed", detail: `retry DM failed: ${describeError(err)}` });
    }
  }

  // Got an email: push to the CRM, then deliver the link.
  const details: string[] = [`email ${email}`];
  let ghlContactId: string | null = null;
  const ghl = deps.ghlClient?.() ?? null;
  if (ghl) {
    try {
      const result = await ghl.syncLead({ email, username: conversation.username, tags: automation.ghlTags, source: "ConvertlySocial" });
      ghlContactId = result.contactId;
      details.push(result.created ? "GHL contact created" : "GHL contact updated");
    } catch (err) {
      details.push(`GHL sync failed: ${describeError(err)}`);
      log("GHL sync failed", err);
    }
  } else {
    details.push("GHL not configured");
  }

  try {
    await client.sendMessage(event.igUserId, event.senderId, linkMessage(automation, conversation.username));
    details.push("link sent");
    await save({ state: "done", email, ghlContactId });
    return finish({ ...base, automationId: automation.id, status: "captured", detail: details.join("; ") });
  } catch (err) {
    details.push(`link DM failed: ${describeError(err)}`);
    log("link DM failed", err);
    // Keep the email even if the DM failed; the lead is still worth having.
    await save({ state: "done", email, ghlContactId });
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

export async function handleMessageEvents(events: MessageEvent[], deps: RunnerDeps): Promise<ActivityRecord[]> {
  const results: ActivityRecord[] = [];
  for (const event of events) {
    const r = await handleMessageEvent(event, deps);
    if (r) results.push(r);
  }
  return results;
}

function describeError(err: unknown): string {
  if (err instanceof InstagramApiError) {
    const code = [err.code, err.subcode].filter((x) => x !== undefined).join("/");
    return `${err.message}${code ? ` (code ${code})` : ""}`;
  }
  if (err instanceof GhlApiError) return `${err.message} (HTTP ${err.status})`;
  return err instanceof Error ? err.message : String(err);
}

export type { Automation };
