import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, hasSupabase } from "./env";
import type { AccountSettings, ActivityRecord, Automation, Conversation, IgAccount } from "./types";

export interface Store {
  listAutomations(igUserId?: string): Promise<Automation[]>;
  getAutomation(id: string): Promise<Automation | null>;
  upsertAutomation(a: Omit<Automation, "id" | "createdAt"> & { id?: string }): Promise<Automation>;
  deleteAutomation(id: string): Promise<void>;

  /** Returns true if this comment id has already been handled (webhooks can be delivered twice). */
  hasHandled(commentId: string): Promise<boolean>;
  recordActivity(record: ActivityRecord): Promise<void>;
  listActivity(limit?: number): Promise<ActivityRecord[]>;
  /** All activity since an ISO timestamp, oldest first (capped). */
  listActivitySince(sinceIso: string, limit?: number): Promise<ActivityRecord[]>;

  getAccount(igUserId: string): Promise<IgAccount | null>;
  listAccounts(): Promise<IgAccount[]>;
  upsertAccount(account: IgAccount): Promise<void>;

  /** Email-capture conversations, keyed by account + Instagram-scoped user id. */
  getConversation(igUserId: string, igsid: string): Promise<Conversation | null>;
  upsertConversation(conversation: Conversation): Promise<void>;
  /** Captured leads, newest first. */
  listLeads(limit?: number): Promise<Conversation[]>;

  getSettings(igUserId: string): Promise<AccountSettings | null>;
  upsertSettings(settings: AccountSettings): Promise<void>;
}

/* ---------- Supabase implementation ---------- */

type AutomationRow = {
  id: string;
  triggers: Automation["triggers"];
  name: string;
  offer_name: string;
  ig_user_id: string;
  media_id: string | null;
  keywords: string[];
  match_mode: "contains" | "exact";
  public_replies: string[];
  dm_text: string;
  dm_link: string | null;
  dm_button_title: string | null;
  ignore_replies: boolean;
  active: boolean;
  collect_email: boolean;
  email_prompt: string;
  email_retry_text: string;
  ghl_tags: string[];
  deliver_by_email_only: boolean;
  email_sent_text: string;
  follow_up_messages: string[];
  intent_description: string;
  ai_faq: string;
  require_opt_in: boolean;
  opt_in_prompt: string;
  opt_in_button: string;
  require_follow: boolean;
  follow_prompt: string;
  created_at: string;
};

type ConversationRow = {
  ig_user_id: string;
  igsid: string;
  username: string;
  automation_id: string;
  comment_id: string;
  state: Conversation["state"];
  attempts: number;
  email: string | null;
  ghl_contact_id: string | null;
  last_message_id: string | null;
  closed_reason: Conversation["closedReason"];
  reopened: boolean;
  created_at: string;
  updated_at: string;
};

function rowToConversation(r: ConversationRow): Conversation {
  return {
    igUserId: r.ig_user_id,
    igsid: r.igsid,
    username: r.username,
    automationId: r.automation_id,
    commentId: r.comment_id,
    state: r.state,
    attempts: r.attempts,
    email: r.email,
    ghlContactId: r.ghl_contact_id,
    lastMessageId: r.last_message_id,
    closedReason: r.closed_reason ?? null,
    reopened: r.reopened ?? false,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToAutomation(r: AutomationRow): Automation {
  return {
    id: r.id,
    triggers: r.triggers?.length ? r.triggers : ["comment"],
    name: r.name,
    offerName: r.offer_name ?? "",
    igUserId: r.ig_user_id,
    mediaId: r.media_id,
    keywords: r.keywords ?? [],
    matchMode: r.match_mode,
    publicReplies: r.public_replies ?? [],
    dmText: r.dm_text,
    dmLink: r.dm_link,
    dmButtonTitle: r.dm_button_title,
    ignoreReplies: r.ignore_replies,
    active: r.active,
    collectEmail: r.collect_email ?? false,
    emailPrompt: r.email_prompt ?? "",
    emailRetryText: r.email_retry_text ?? "",
    ghlTags: r.ghl_tags ?? [],
    deliverByEmailOnly: r.deliver_by_email_only ?? false,
    emailSentText: r.email_sent_text ?? "",
    followUpMessages: r.follow_up_messages ?? [],
    intentDescription: r.intent_description ?? "",
    aiFaq: r.ai_faq ?? "",
    requireOptIn: r.require_opt_in ?? true,
    optInPrompt: r.opt_in_prompt ?? "",
    optInButton: r.opt_in_button ?? "",
    requireFollow: r.require_follow ?? false,
    followPrompt: r.follow_prompt ?? "",
    createdAt: r.created_at,
  };
}

export class SupabaseStore implements Store {
  constructor(private readonly db: SupabaseClient) {}

  async listAutomations(igUserId?: string) {
    let q = this.db.from("cs_automations").select("*").order("created_at", { ascending: true });
    if (igUserId) q = q.eq("ig_user_id", igUserId);
    const { data, error } = await q;
    if (error) throw error;
    return (data as AutomationRow[]).map(rowToAutomation);
  }

  async getAutomation(id: string) {
    const { data, error } = await this.db.from("cs_automations").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? rowToAutomation(data as AutomationRow) : null;
  }

  async upsertAutomation(a: Omit<Automation, "id" | "createdAt"> & { id?: string }) {
    const row = {
      ...(a.id ? { id: a.id } : {}),
      triggers: a.triggers,
      name: a.name,
      offer_name: a.offerName,
      ig_user_id: a.igUserId,
      media_id: a.mediaId,
      keywords: a.keywords,
      match_mode: a.matchMode,
      public_replies: a.publicReplies,
      dm_text: a.dmText,
      dm_link: a.dmLink,
      dm_button_title: a.dmButtonTitle,
      ignore_replies: a.ignoreReplies,
      active: a.active,
      collect_email: a.collectEmail,
      email_prompt: a.emailPrompt,
      email_retry_text: a.emailRetryText,
      ghl_tags: a.ghlTags,
      deliver_by_email_only: a.deliverByEmailOnly,
      email_sent_text: a.emailSentText,
      follow_up_messages: a.followUpMessages,
      intent_description: a.intentDescription,
      ai_faq: a.aiFaq,
      require_opt_in: a.requireOptIn,
      opt_in_prompt: a.optInPrompt,
      opt_in_button: a.optInButton,
      require_follow: a.requireFollow,
      follow_prompt: a.followPrompt,
    };
    const { data, error } = await this.db.from("cs_automations").upsert(row).select("*").single();
    if (error) throw error;
    return rowToAutomation(data as AutomationRow);
  }

  async deleteAutomation(id: string) {
    const { error } = await this.db.from("cs_automations").delete().eq("id", id);
    if (error) throw error;
  }

  async hasHandled(commentId: string) {
    const { data, error } = await this.db.from("cs_activity").select("id").eq("comment_id", commentId).in("status", ["sent", "failed"]).limit(1);
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }

  async recordActivity(r: ActivityRecord) {
    const { error } = await this.db.from("cs_activity").insert({
      comment_id: r.commentId,
      ig_user_id: r.igUserId,
      automation_id: r.automationId,
      from_username: r.fromUsername,
      comment_text: r.commentText,
      status: r.status,
      detail: r.detail,
      category: r.category ?? null,
      suggested_reply: r.suggestedReply ?? null,
    });
    if (error) throw error;
  }

  async listActivity(limit = 50) {
    const { data, error } = await this.db.from("cs_activity").select("*").order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id,
      commentId: r.comment_id,
      igUserId: r.ig_user_id,
      automationId: r.automation_id,
      fromUsername: r.from_username,
      commentText: r.comment_text,
      status: r.status,
      detail: r.detail,
      category: r.category ?? null,
      suggestedReply: r.suggested_reply ?? null,
      createdAt: r.created_at,
    })) as ActivityRecord[];
  }

  async listActivitySince(sinceIso: string, limit = 5000) {
    const { data, error } = await this.db.from("cs_activity").select("*").gte("created_at", sinceIso).order("created_at", { ascending: true }).limit(limit);
    if (error) throw error;
    return (data ?? []).map((r) => ({
      id: r.id,
      commentId: r.comment_id,
      igUserId: r.ig_user_id,
      automationId: r.automation_id,
      fromUsername: r.from_username,
      commentText: r.comment_text,
      status: r.status,
      detail: r.detail,
      category: r.category ?? null,
      suggestedReply: r.suggested_reply ?? null,
      createdAt: r.created_at,
    })) as ActivityRecord[];
  }

  async getAccount(igUserId: string) {
    const { data, error } = await this.db.from("cs_ig_accounts").select("*").eq("ig_user_id", igUserId).maybeSingle();
    if (error) throw error;
    return data ? { igUserId: data.ig_user_id, username: data.username, accessToken: data.access_token, tokenExpiresAt: data.token_expires_at } : null;
  }

  async listAccounts() {
    const { data, error } = await this.db.from("cs_ig_accounts").select("*");
    if (error) throw error;
    return (data ?? []).map((d) => ({ igUserId: d.ig_user_id, username: d.username, accessToken: d.access_token, tokenExpiresAt: d.token_expires_at }));
  }

  async upsertAccount(a: IgAccount) {
    const { error } = await this.db.from("cs_ig_accounts").upsert({
      ig_user_id: a.igUserId,
      username: a.username,
      access_token: a.accessToken,
      token_expires_at: a.tokenExpiresAt,
    });
    if (error) throw error;
  }

  async getConversation(igUserId: string, igsid: string) {
    const { data, error } = await this.db.from("cs_conversations").select("*").eq("ig_user_id", igUserId).eq("igsid", igsid).maybeSingle();
    if (error) throw error;
    return data ? rowToConversation(data as ConversationRow) : null;
  }

  async upsertConversation(c: Conversation) {
    const { error } = await this.db.from("cs_conversations").upsert({
      ig_user_id: c.igUserId,
      igsid: c.igsid,
      username: c.username,
      automation_id: c.automationId,
      comment_id: c.commentId,
      state: c.state,
      attempts: c.attempts,
      email: c.email,
      ghl_contact_id: c.ghlContactId,
      last_message_id: c.lastMessageId ?? null,
      closed_reason: c.closedReason ?? null,
      reopened: c.reopened ?? false,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  async listLeads(limit = 100) {
    const { data, error } = await this.db.from("cs_conversations").select("*").eq("state", "done").order("updated_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return (data as ConversationRow[]).map(rowToConversation);
  }

  async getSettings(igUserId: string) {
    const { data, error } = await this.db.from("cs_settings").select("*").eq("ig_user_id", igUserId).maybeSingle();
    if (error) throw error;
    return data ? { igUserId: data.ig_user_id, voiceSamples: data.voice_samples ?? "", brandNotes: data.brand_notes ?? "" } : null;
  }

  async upsertSettings(s: AccountSettings) {
    const { error } = await this.db.from("cs_settings").upsert({
      ig_user_id: s.igUserId,
      voice_samples: s.voiceSamples,
      brand_notes: s.brandNotes,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  }
}

/* ---------- In-memory / env-JSON implementation (no database) ---------- */

export class MemoryStore implements Store {
  private automations: Automation[];
  private activity: ActivityRecord[] = [];
  private accounts = new Map<string, IgAccount>();
  private conversations = new Map<string, Conversation>();
  private settings = new Map<string, AccountSettings>();

  constructor(seed: Automation[] = []) {
    this.automations = [...seed];
  }

  async listAutomations(igUserId?: string) {
    return this.automations.filter((a) => !igUserId || a.igUserId === igUserId);
  }
  async getAutomation(id: string) {
    return this.automations.find((a) => a.id === id) ?? null;
  }
  async upsertAutomation(a: Omit<Automation, "id" | "createdAt"> & { id?: string }) {
    const id = a.id ?? crypto.randomUUID();
    const full: Automation = { ...a, id, createdAt: new Date().toISOString() };
    const idx = this.automations.findIndex((x) => x.id === id);
    if (idx >= 0) this.automations[idx] = full;
    else this.automations.push(full);
    return full;
  }
  async deleteAutomation(id: string) {
    this.automations = this.automations.filter((a) => a.id !== id);
  }
  async hasHandled(commentId: string) {
    return this.activity.some((r) => r.commentId === commentId && r.status !== "skipped");
  }
  async recordActivity(r: ActivityRecord) {
    this.activity.unshift({ ...r, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
    this.activity = this.activity.slice(0, 500);
  }
  async listActivity(limit = 50) {
    return this.activity.slice(0, limit);
  }
  async listActivitySince(sinceIso: string, limit = 5000) {
    return this.activity.filter((r) => (r.createdAt ?? "") >= sinceIso).slice(0, limit).reverse();
  }
  async getAccount(igUserId: string) {
    return this.accounts.get(igUserId) ?? null;
  }
  async listAccounts() {
    return [...this.accounts.values()];
  }
  async upsertAccount(a: IgAccount) {
    this.accounts.set(a.igUserId, a);
  }
  async getConversation(igUserId: string, igsid: string) {
    return this.conversations.get(`${igUserId}:${igsid}`) ?? null;
  }
  async upsertConversation(c: Conversation) {
    const now = new Date().toISOString();
    const existing = this.conversations.get(`${c.igUserId}:${c.igsid}`);
    this.conversations.set(`${c.igUserId}:${c.igsid}`, { ...c, createdAt: existing?.createdAt ?? now, updatedAt: now });
  }
  async listLeads(limit = 100) {
    return [...this.conversations.values()]
      .filter((c) => c.state === "done")
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
      .slice(0, limit);
  }
  async getSettings(igUserId: string) {
    return this.settings.get(igUserId) ?? null;
  }
  async upsertSettings(s: AccountSettings) {
    this.settings.set(s.igUserId, s);
  }
}

/** Parses AUTOMATIONS_JSON so a deployment can run without a database. */
export function automationsFromEnv(json: string): Automation[] {
  if (!json.trim()) return [];
  const parsed = JSON.parse(json) as Array<Partial<Automation>>;
  return parsed.map((a, i) => ({
    id: a.id ?? `env-${i}`,
    triggers: a.triggers ?? ["comment"],
    name: a.name ?? `Automation ${i + 1}`,
    offerName: a.offerName ?? "",
    igUserId: a.igUserId ?? env.igUserId,
    mediaId: a.mediaId ?? null,
    keywords: a.keywords ?? [],
    matchMode: a.matchMode ?? "contains",
    publicReplies: a.publicReplies ?? [],
    dmText: a.dmText ?? "",
    dmLink: a.dmLink ?? null,
    dmButtonTitle: a.dmButtonTitle ?? null,
    ignoreReplies: a.ignoreReplies ?? true,
    active: a.active ?? true,
    collectEmail: a.collectEmail ?? false,
    emailPrompt: a.emailPrompt ?? "",
    emailRetryText: a.emailRetryText ?? "",
    ghlTags: a.ghlTags ?? [],
    deliverByEmailOnly: a.deliverByEmailOnly ?? false,
    emailSentText: a.emailSentText ?? "",
    followUpMessages: a.followUpMessages ?? [],
    intentDescription: a.intentDescription ?? "",
    aiFaq: a.aiFaq ?? "",
    requireOptIn: a.requireOptIn ?? true,
    optInPrompt: a.optInPrompt ?? "",
    optInButton: a.optInButton ?? "",
    requireFollow: a.requireFollow ?? false,
    followPrompt: a.followPrompt ?? "",
  }));
}

let cached: Store | null = null;

/** Returns the configured store: Supabase when credentials exist, otherwise an in-memory store. */
export function getStore(): Store {
  if (cached) return cached;
  if (hasSupabase()) {
    const db = createClient(env.supabaseUrl, env.supabaseServiceKey, { auth: { persistSession: false } });
    cached = new SupabaseStore(db);
  } else {
    cached = new MemoryStore(automationsFromEnv(env.automationsJson));
  }
  return cached;
}
