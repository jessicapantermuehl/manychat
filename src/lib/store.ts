import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, hasSupabase } from "./env";
import type { ActivityRecord, Automation, IgAccount } from "./types";

export interface Store {
  listAutomations(igUserId?: string): Promise<Automation[]>;
  getAutomation(id: string): Promise<Automation | null>;
  upsertAutomation(a: Omit<Automation, "id" | "createdAt"> & { id?: string }): Promise<Automation>;
  deleteAutomation(id: string): Promise<void>;

  /** Returns true if this comment id has already been handled (webhooks can be delivered twice). */
  hasHandled(commentId: string): Promise<boolean>;
  recordActivity(record: ActivityRecord): Promise<void>;
  listActivity(limit?: number): Promise<ActivityRecord[]>;

  getAccount(igUserId: string): Promise<IgAccount | null>;
  listAccounts(): Promise<IgAccount[]>;
  upsertAccount(account: IgAccount): Promise<void>;
}

/* ---------- Supabase implementation ---------- */

type AutomationRow = {
  id: string;
  name: string;
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
  created_at: string;
};

function rowToAutomation(r: AutomationRow): Automation {
  return {
    id: r.id,
    name: r.name,
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
      name: a.name,
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
}

/* ---------- In-memory / env-JSON implementation (no database) ---------- */

export class MemoryStore implements Store {
  private automations: Automation[];
  private activity: ActivityRecord[] = [];
  private accounts = new Map<string, IgAccount>();

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
  async getAccount(igUserId: string) {
    return this.accounts.get(igUserId) ?? null;
  }
  async listAccounts() {
    return [...this.accounts.values()];
  }
  async upsertAccount(a: IgAccount) {
    this.accounts.set(a.igUserId, a);
  }
}

/** Parses AUTOMATIONS_JSON so a deployment can run without a database. */
export function automationsFromEnv(json: string): Automation[] {
  if (!json.trim()) return [];
  const parsed = JSON.parse(json) as Array<Partial<Automation>>;
  return parsed.map((a, i) => ({
    id: a.id ?? `env-${i}`,
    name: a.name ?? `Automation ${i + 1}`,
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
