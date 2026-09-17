import { getAi, type Ai, type Triage } from "./ai";
import { env, hasGhl } from "./env";
import { GhlApiError, GhlClient } from "./ghl";
import { buildDmMessage, buildPostbackButtonMessage, InstagramApiError, InstagramClient, type OutgoingMessage } from "./instagram";
import { eligibleAutomations, eligibleInboundAutomations, findAutomation, keywordMatches, pickPreferred, pickRandom, renderTemplate } from "./matching";
import type { Store } from "./store";
import type { ActivityRecord, Automation, CommentEvent, Conversation, MessageEvent, TriggerKind } from "./types";
import { extractEmail, looksLikeChangedMind, looksLikeNo, looksLikeStop, looksLikeYes } from "./webhook";

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
export const FOLLOW_DONE = "CS_FOLLOW_DONE";
const DEFAULT_FOLLOW_PROMPT = "One quick thing, {{username}}: the {{offer}} is something I share with my followers 💛 Tap follow on my profile, then hit the button below and I'll send it right over.";
const DEFAULT_FOLLOW_BUTTON = "I'm following!";
/** Ask to follow this many times before going quiet. */
const MAX_FOLLOW_ATTEMPTS = 2;
const DEFAULT_OPT_IN_PROMPT = "Hey {{username}}! Thanks so much for asking for the {{offer}}. Just to confirm, would you like me to send you the link?";
const DEFAULT_OPT_IN_PROMPT_NO_OFFER = "Hey {{username}}! Just to confirm, would you like me to send you the link?";
const DEFAULT_OPT_IN_BUTTON = "Yes please!";
const DEFAULT_EMAIL_SENT_TEXT = "Done! Your {{offer}} is on its way to your inbox, {{username}}. Give it a couple of minutes, and check spam or promotions if it's not there 💌";

function vars(username: string, automation: Automation) {
  return { username, link: automation.dmLink ?? "", offer: automation.offerName.trim() };
}

function optInMessage(automation: Automation, username: string): OutgoingMessage {
  const fallback = automation.offerName.trim() ? DEFAULT_OPT_IN_PROMPT : DEFAULT_OPT_IN_PROMPT_NO_OFFER;
  const prompt = renderTemplate(automation.optInPrompt.trim() || fallback, vars(username, automation));
  const yes = automation.optInButton.trim() || DEFAULT_OPT_IN_BUTTON;
  // One button, inside the bubble (a button template, not a floating quick-reply chip).
  // They asked for this by commenting, so the DM is a confirmation, not a survey.
  // Not tapping is the "no"; typed "no" / "stop" replies are still honoured.
  return buildPostbackButtonMessage(prompt, [{ title: yes, payload: OPT_IN_YES }]);
}

const MAX_FOLLOW_UPS = 3;

/** Sends the automation's extra messages in order. Only valid inside an open messaging window. */
async function sendFollowUps(client: InstagramClient, igUserId: string, igsid: string, automation: Automation, username: string, details: string[], log: (m: string, e?: unknown) => void) {
  const messages = automation.followUpMessages.map((m) => m.trim()).filter(Boolean).slice(0, MAX_FOLLOW_UPS);
  let sent = 0;
  for (const m of messages) {
    try {
      await client.sendMessage(igUserId, igsid, { text: renderTemplate(m, vars(username, automation)).slice(0, 1000) });
      sent += 1;
    } catch (err) {
      log("follow-up failed", err);
      details.push(`follow-up ${sent + 1} failed: ${describeError(err)}`);
      break;
    }
  }
  if (sent > 0) details.push(`${sent} follow-up${sent === 1 ? "" : "s"} sent`);
}

function followMessage(automation: Automation, username: string): OutgoingMessage {
  const prompt = renderTemplate(automation.followPrompt.trim() || DEFAULT_FOLLOW_PROMPT, vars(username, automation));
  return buildPostbackButtonMessage(prompt, [{ title: DEFAULT_FOLLOW_BUTTON, payload: FOLLOW_DONE }]);
}

/**
 * Asks Instagram whether this person follows the account. Fails open: if the lookup errors
 * (permissions, rate limit) we treat them as following rather than block a real request.
 */
async function isFollowing(client: InstagramClient, igsid: string, log: (m: string, e?: unknown) => void): Promise<{ following: boolean; checked: boolean }> {
  try {
    const profile = await client.getUserProfile(igsid);
    if (typeof profile.is_user_follow_business !== "boolean") return { following: true, checked: false };
    return { following: profile.is_user_follow_business, checked: true };
  } catch (err) {
    log("follow check failed", err);
    return { following: true, checked: false };
  }
}

function linkMessage(automation: Automation, username: string): OutgoingMessage {
  let text = renderTemplate(automation.dmText, vars(username, automation));
  const link = automation.dmLink?.trim() ?? "";
  // The link must reach them. If the text has no {{link}} and there is no button, append it.
  if (link && !automation.dmButtonTitle?.trim() && !/\{\{\s*link\s*\}\}/i.test(automation.dmText) && !text.includes(link)) {
    text = `${text.trimEnd()}\n\n${link}`;
  }
  return buildDmMessage(text, automation.dmLink, automation.dmButtonTitle);
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
  const triagePromise: Promise<{ triage: Triage | null; error: string | null }> = ai && event.text.trim()
    ? ai
        .triageComment(event.text, voice)
        .then((triage) => ({ triage, error: null }))
        .catch((err) => {
          log("triage failed", err);
          return { triage: null, error: describeError(err) };
        })
    : Promise.resolve({ triage: null, error: null });
  // Attach the triage result, or surface the AI error in the detail so the dashboard shows why the Type column is blank.
  const withTriage = async (record: ActivityRecord): Promise<ActivityRecord> => {
    const { triage, error } = await triagePromise;
    if (triage) return { ...record, category: triage.category, suggestedReply: triage.suggestedReply };
    if (error) return { ...record, detail: `${record.detail}; AI triage failed: ${error}` };
    return record;
  };

  const details: string[] = [];
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
        details.push(`AI intent matching failed: ${describeError(err)}`);
      }
    }
  }
  if (!automation) {
    return finish(await withTriage({ ...base, automationId: null, status: "skipped", detail: ["no matching automation", ...details].join("; ") }));
  }
  if (matchedBy === "intent") details.push("matched by AI intent");

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
      if (automation.followUpMessages.some((m) => m.trim())) details.push("follow-ups skipped: they need the opt-in step (Meta allows one message per comment)");
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
      closedReason: null,
      reopened: false,
    });
    return finish(await withTriage({ ...base, automationId: automation.id, status: "sent", detail: details.join("; ") }));
  } catch (err) {
    details.push(`DM failed: ${describeError(err)}`);
    log("DM failed", err);
    return finish(await withTriage({ ...base, automationId: automation.id, status: "failed", detail: details.join("; ") }));
  }
}

/**
 * The step after consent, inside an open window: follow gate (optional) → email question
 * (optional) → link + follow-ups. Shared by the opt-in Yes, the follow-gate pass and inbound triggers.
 */
async function deliverAfterConsent(
  event: MessageEvent,
  conversation: Conversation,
  automation: Automation,
  client: InstagramClient,
  deps: RunnerDeps,
  base: Base,
  finish: Finish,
  save: Save,
  details: string[],
  opts: { skipFollowGate?: boolean } = {},
): Promise<ActivityRecord> {
  const log = deps.log ?? (() => {});
  try {
    if (automation.requireFollow && !opts.skipFollowGate) {
      const follow = await isFollowing(client, event.senderId, log);
      if (!follow.checked) details.push("follow status unknown, skipped gate");
      if (follow.checked && !follow.following) {
        await client.sendMessage(event.igUserId, event.senderId, followMessage(automation, conversation.username));
        await save({ state: "awaiting_follow", attempts: 1 });
        details.push("asked to follow first");
        return finish({ ...base, automationId: automation.id, status: "sent", detail: details.join("; ") });
      }
      if (follow.checked) details.push("already following");
    }
    if (automation.collectEmail && automation.emailPrompt.trim()) {
      await client.sendMessage(event.igUserId, event.senderId, emailPromptMessage(automation, conversation.username));
      await save({ state: "awaiting_email", attempts: 1 });
      details.push("asked for email");
      return finish({ ...base, automationId: automation.id, status: "sent", detail: details.join("; ") });
    }
    await client.sendMessage(event.igUserId, event.senderId, linkMessage(automation, conversation.username));
    details.push("link sent");
    await sendFollowUps(client, event.igUserId, event.senderId, automation, conversation.username, details, log);
    await save({ state: "done" });
    return finish({ ...base, automationId: automation.id, status: "sent", detail: details.join("; ") });
  } catch (err) {
    log("delivery DM failed", err);
    details.push(`DM failed: ${describeError(err)}`);
    return finish({ ...base, automationId: automation.id, status: "failed", detail: details.join("; ") });
  }
}

/** Which inbound trigger kind a message is, or null for a plain button tap. */
function inboundKind(event: MessageEvent): Exclude<TriggerKind, "comment"> | null {
  if (event.payload) return null;
  if (event.storyMention) return "story_mention";
  if (event.storyReplyId) return "story_reply";
  if (event.text.trim()) return "dm";
  return null;
}

/**
 * A message that is not part of a conversation we are running: a story reply, a story mention or
 * a keyword DM. Because the person messaged first, the 24-hour window is already open, so no
 * opt-in step is needed; delivery starts straight away.
 */
async function handleInboundTrigger(event: MessageEvent, existing: Conversation | null, deps: RunnerDeps): Promise<ActivityRecord | null> {
  const { store } = deps;
  const log = deps.log ?? (() => {});
  const kind = inboundKind(event);
  if (!kind) return null;

  const automations = await store.listAutomations(event.igUserId);
  const candidates = eligibleInboundAutomations(kind, event.igUserId, automations);
  if (candidates.length === 0) return null;

  // Story mentions have no text to match; every other kind matches on keywords first, then AI intent.
  let automation: Automation | null = null;
  let matchedBy = "keyword";
  if (kind === "story_mention") {
    automation = pickPreferred(candidates);
  } else {
    automation = pickPreferred(candidates.filter((a) => a.keywords.length > 0 && keywordMatches(event.text, a.keywords, a.matchMode)));
    const ai = deps.ai?.() ?? null;
    if (!automation && ai) {
      const withIntent = candidates.filter((a) => a.intentDescription.trim());
      if (withIntent.length > 0) {
        try {
          const id = await ai.classifyIntent(event.text, withIntent.map((a) => ({ id: a.id, name: a.name, intentDescription: a.intentDescription })));
          automation = pickPreferred(withIntent.filter((a) => a.id === id));
          matchedBy = "intent";
        } catch (err) {
          log("intent matching failed", err);
        }
      }
    }
  }
  if (!automation) return null;

  const client = await deps.clientFor(event.igUserId);
  const label = kind === "story_reply" ? "story reply" : kind === "story_mention" ? "story mention" : "DM keyword";
  const base: Base = {
    commentId: event.messageId,
    igUserId: event.igUserId,
    fromUsername: existing?.username ?? "",
    commentText: event.text || (kind === "story_mention" ? "[story mention]" : ""),
  };
  const finish: Finish = async (record) => {
    try {
      await store.recordActivity(record);
    } catch (err) {
      log("failed to record activity", err);
    }
    return record;
  };
  if (!client) {
    return finish({ ...base, automationId: automation.id, status: "failed", detail: `${label} trigger; no access token for this account` });
  }

  // Fill in the username for the templates when we do not know it yet.
  let username = existing?.username ?? "";
  if (!username) {
    try {
      username = (await client.getUserProfile(event.senderId)).username ?? "";
    } catch (err) {
      log("profile lookup failed", err);
    }
  }
  const conversation: Conversation = {
    igUserId: event.igUserId,
    igsid: event.senderId,
    username,
    automationId: automation.id,
    commentId: event.messageId,
    state: "awaiting_optin",
    attempts: 1,
    email: null,
    ghlContactId: null,
    lastMessageId: event.messageId,
    closedReason: null,
    reopened: false,
  };
  const save: Save = (patch) => store.upsertConversation({ ...conversation, ...patch, lastMessageId: event.messageId });
  const details = [`${label} trigger`, ...(matchedBy === "intent" ? ["matched by AI intent"] : [])];
  return deliverAfterConsent(event, conversation, automation, client, deps, { ...base, fromUsername: username }, finish, save, details);
}

/**
 * Processes one inbound DM or button tap. Conversations the app is running continue; a message
 * from anyone else is checked against story-reply, story-mention and DM-keyword triggers, and is
 * otherwise ignored so the app never talks to people who did not ask for something.
 */
export async function handleMessageEvent(event: MessageEvent, deps: RunnerDeps): Promise<ActivityRecord | null> {
  const { store } = deps;
  const log = deps.log ?? (() => {});

  const conversation = await store.getConversation(event.igUserId, event.senderId);
  // Meta can redeliver a webhook; never act on the same message twice.
  if (conversation?.lastMessageId && conversation.lastMessageId === event.messageId) return null;

  if (!conversation) return handleInboundTrigger(event, null, deps);

  // A stop word after a finished conversation still counts: mark it so no later keyword re-triggers.
  if ((conversation.state === "done" || conversation.state === "abandoned") && !event.payload && looksLikeStop(event.text)) {
    if (conversation.closedReason !== "stopped") {
      await store.upsertConversation({ ...conversation, state: "abandoned", closedReason: "stopped", lastMessageId: event.messageId });
      const record: ActivityRecord = { commentId: conversation.commentId, igUserId: event.igUserId, fromUsername: conversation.username, commentText: event.text, automationId: conversation.automationId, status: "skipped", detail: "asked to stop; will not be messaged again" };
      try {
        await store.recordActivity(record);
      } catch (err) {
        log("failed to record activity", err);
      }
      return record;
    }
    return null;
  }

  if (conversation.state === "done") return handleInboundTrigger(event, conversation, deps);
  if (conversation.state === "abandoned") {
    // Someone who asked us to stop is never messaged again.
    if (conversation.closedReason === "stopped") return null;
    // They tapped No by accident and say so: send the opt-in question once more.
    const canReopen = conversation.closedReason === "declined" && !conversation.reopened && !event.payload && looksLikeChangedMind(event.text);
    if (canReopen) return reopenAfterDecline(event, conversation, deps);
    // Otherwise a fresh keyword or story reply can start a new flow.
    return handleInboundTrigger(event, conversation, deps);
  }

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
    await save({ state: "abandoned", closedReason: "expired" });
    return finish({ ...base, automationId: conversation.automationId, status: "skipped", detail: "conversation expired" });
  }

  // A stop word ends the conversation for good; a plain no closes it but can be reopened once.
  if (!event.payload && looksLikeStop(event.text)) {
    await save({ state: "abandoned", closedReason: "stopped" });
    return finish({ ...base, automationId: conversation.automationId, status: "skipped", detail: "asked to stop; conversation closed" });
  }
  if (event.payload === OPT_IN_NO || (!event.payload && looksLikeNo(event.text))) {
    await save({ state: "abandoned", closedReason: "declined" });
    return finish({ ...base, automationId: conversation.automationId, status: "skipped", detail: "declined; conversation closed" });
  }

  const automation = await store.getAutomation(conversation.automationId);
  const client = await deps.clientFor(event.igUserId);
  if (!automation || !client) {
    await save({ state: "abandoned", closedReason: "error" });
    return finish({ ...base, automationId: conversation.automationId, status: "failed", detail: automation ? "no access token for this account" : "automation no longer exists" });
  }

  if (conversation.state === "awaiting_optin") {
    return handleOptInReply(event, conversation, automation, client, deps, base, finish, save);
  }
  if (conversation.state === "awaiting_follow") {
    return handleFollowReply(event, conversation, automation, client, deps, base, finish, save);
  }
  return handleEmailReply(event, conversation, automation, client, deps, base, finish, save);
}

/** They were asked to follow. On any reply, re-check; deliver once they follow, remind once, then go quiet. */
async function handleFollowReply(
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
  const follow = await isFollowing(client, event.senderId, log);
  if (!follow.checked || follow.following) {
    const details = [follow.checked ? "now following" : "follow status unknown, continuing"];
    return deliverAfterConsent(event, conversation, automation, client, deps, base, finish, save, details, { skipFollowGate: true });
  }
  if (conversation.attempts >= MAX_FOLLOW_ATTEMPTS) {
    await save({ state: "abandoned", closedReason: "no_response" });
    return finish({ ...base, automationId: automation.id, status: "skipped", detail: "still not following after reminder; conversation closed" });
  }
  try {
    const nudge = event.payload === FOLLOW_DONE
      ? "Hmm, I don't see the follow on my side yet. It can take a moment; try tapping follow on my profile once more, then the button again 💛"
      : renderTemplate(automation.followPrompt.trim() || DEFAULT_FOLLOW_PROMPT, vars(conversation.username, automation));
    await client.sendMessage(event.igUserId, event.senderId, buildPostbackButtonMessage(nudge, [{ title: DEFAULT_FOLLOW_BUTTON, payload: FOLLOW_DONE }]));
    await save({ attempts: conversation.attempts + 1 });
    return finish({ ...base, automationId: automation.id, status: "sent", detail: "not following yet; asked again" });
  } catch (err) {
    log("follow reminder failed", err);
    return finish({ ...base, automationId: automation.id, status: "failed", detail: `follow reminder failed: ${describeError(err)}` });
  }
}

/** They tapped No, then said "wait, I do want it": send the opt-in question once more. */
async function reopenAfterDecline(event: MessageEvent, conversation: Conversation, deps: RunnerDeps): Promise<ActivityRecord | null> {
  const { store } = deps;
  const log = deps.log ?? (() => {});
  const base = { commentId: conversation.commentId, igUserId: event.igUserId, fromUsername: conversation.username, commentText: event.text };
  const automation = await store.getAutomation(conversation.automationId);
  const client = await deps.clientFor(event.igUserId);
  // Only opt-in automations have a question to re-send.
  if (!automation || !client || !automation.requireOptIn) return null;

  const record: ActivityRecord = { ...base, automationId: automation.id, status: "sent", detail: "changed their mind; asked for opt-in again" };
  try {
    await client.sendMessage(event.igUserId, event.senderId, optInMessage(automation, conversation.username));
    await store.upsertConversation({ ...conversation, state: "awaiting_optin", attempts: 1, closedReason: null, reopened: true, lastMessageId: event.messageId });
  } catch (err) {
    log("reopen DM failed", err);
    record.status = "failed";
    record.detail = `re-sending opt-in failed: ${describeError(err)}`;
  }
  try {
    await store.recordActivity(record);
  } catch (err) {
    log("failed to record activity", err);
  }
  return record;
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
      await save({ state: "abandoned", closedReason: "no_response" });
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

  // They said yes: the 24-hour window is open. Follow gate → email question → link.
  return deliverAfterConsent(event, conversation, automation, client, deps, base, finish, save, ["opted in"]);
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
      await save({ state: "abandoned", closedReason: "no_response" });
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

  // Deliver by email only when the CRM has the contact; otherwise fall back to the link so they still get it.
  const byEmail = automation.deliverByEmailOnly && ghlContactId !== null;
  try {
    if (byEmail) {
      const text = automation.emailSentText.trim() || DEFAULT_EMAIL_SENT_TEXT;
      await client.sendMessage(event.igUserId, event.senderId, { text: renderTemplate(text, v).slice(0, 1000) });
      details.push("confirmation sent; delivery by email");
    } else {
      if (automation.deliverByEmailOnly) details.push("CRM unavailable, sent link instead");
      await client.sendMessage(event.igUserId, event.senderId, linkMessage(automation, conversation.username));
      details.push("link sent");
    }
    await sendFollowUps(client, event.igUserId, event.senderId, automation, conversation.username, details, log);
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
  if (err && typeof err === "object" && "status" in err && "message" in err && (err as { name?: string }).name?.endsWith("Error") && !(err instanceof InstagramApiError) && !(err instanceof GhlApiError)) {
    const e = err as { status?: number; message: string };
    return e.status ? `${e.message} (HTTP ${e.status})` : e.message;
  }
  if (err instanceof InstagramApiError) {
    const code = [err.code, err.subcode].filter((x) => x !== undefined).join("/");
    return `${err.message}${code ? ` (code ${code})` : ""}`;
  }
  if (err instanceof GhlApiError) return `${err.message} (HTTP ${err.status})`;
  return err instanceof Error ? err.message : String(err);
}

export type { Automation };
