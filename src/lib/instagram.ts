/**
 * Thin client for the Instagram API with Instagram Login.
 * Docs: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
 *
 * Endpoints used:
 *   POST /{ig-user-id}/messages           send a DM, or a private reply when recipient.comment_id is set
 *   POST /{comment-id}/replies            reply publicly under a comment
 *   GET  /me?fields=user_id,username      identify the connected account
 *   POST /{ig-user-id}/subscribed_apps    subscribe the account to webhook fields
 *   GET  /access_token                    exchange short-lived token for a 60-day token
 *   GET  /refresh_access_token            refresh a long-lived token
 */

export interface InstagramClientOptions {
  apiVersion?: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export class InstagramApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: number,
    public readonly subcode?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "InstagramApiError";
  }
}

export interface QuickReply {
  content_type: "text";
  title: string;
  payload: string;
}

export type OutgoingMessage =
  | { text: string; quick_replies?: QuickReply[] }
  | {
      attachment: {
        type: "template";
        payload: {
          template_type: "button";
          text: string;
          buttons: Array<{ type: "web_url"; url: string; title: string } | { type: "postback"; title: string; payload: string }>;
        };
      };
    };

/** A message with tappable buttons inside the bubble (up to 3, titles up to 20 chars, text up to 640). */
export function buildPostbackButtonMessage(text: string, buttons: Array<{ title: string; payload: string }>): OutgoingMessage {
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: text.slice(0, 640),
        buttons: buttons.slice(0, 3).map((b) => ({ type: "postback", title: b.title.slice(0, 20), payload: b.payload.slice(0, 1000) })),
      },
    },
  };
}

/** A message with link buttons inside the bubble (up to 3, titles up to 20 chars, text up to 640). */
export function buildLinkButtonMessage(text: string, buttons: Array<{ title: string; url: string }>): OutgoingMessage {
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: text.slice(0, 640),
        buttons: buttons.slice(0, 3).map((b) => ({ type: "web_url", url: b.url, title: b.title.slice(0, 20) })),
      },
    },
  };
}

/** A text message with tappable quick-reply chips (Instagram allows up to 13, titles up to 20 chars). */
export function buildQuickReplyMessage(text: string, replies: Array<{ title: string; payload: string }>): OutgoingMessage {
  return {
    text: text.slice(0, 1000),
    quick_replies: replies.slice(0, 13).map((r) => ({ content_type: "text", title: r.title.slice(0, 20), payload: r.payload.slice(0, 1000) })),
  };
}

export function buildDmMessage(text: string, link: string | null, buttonTitle: string | null): OutgoingMessage {
  if (link && buttonTitle) {
    return {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: text.slice(0, 640),
          buttons: [{ type: "web_url", url: link, title: buttonTitle.slice(0, 20) }],
        },
      },
    };
  }
  return { text: text.slice(0, 1000) };
}

export class InstagramClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly accessToken: string, opts: InstagramClientOptions = {}) {
    const version = opts.apiVersion ?? "v21.0";
    this.base = opts.baseUrl ?? `https://graph.instagram.com/${version}`;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: { method?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<T> {
    const url = new URL(`${this.base}/${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
    url.searchParams.set("access_token", this.accessToken);

    const res = await this.fetchImpl(url.toString(), {
      method: init.method ?? "GET",
      headers: init.body ? { "content-type": "application/json" } : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    if (!res.ok) {
      const err = (json as { error?: { message?: string; code?: number; error_subcode?: number } })?.error;
      throw new InstagramApiError(err?.message ?? `Instagram API error (${res.status})`, res.status, err?.code, err?.error_subcode, json);
    }
    return json as T;
  }

  /** Sends a DM to the author of a comment (a "private reply"). One per comment, within 7 days. */
  sendPrivateReply(igUserId: string, commentId: string, message: OutgoingMessage) {
    return this.request<{ recipient_id: string; message_id: string }>(`${igUserId}/messages`, {
      method: "POST",
      body: { recipient: { comment_id: commentId }, message },
    });
  }

  /** Sends a DM to a user by Instagram-scoped id. Only allowed inside the 24h messaging window. */
  sendMessage(igUserId: string, recipientId: string, message: OutgoingMessage) {
    return this.request<{ recipient_id: string; message_id: string }>(`${igUserId}/messages`, {
      method: "POST",
      body: { recipient: { id: recipientId }, message },
    });
  }

  /** Posts a public reply underneath a comment. */
  replyToComment(commentId: string, message: string) {
    return this.request<{ id: string }>(`${commentId}/replies`, {
      method: "POST",
      query: { message: message.slice(0, 2200) },
    });
  }

  /** Looks up a messaging user (by Instagram-scoped id), including whether they follow the account. */
  getUserProfile(igsid: string) {
    return this.request<{ id: string; username?: string; name?: string; is_user_follow_business?: boolean; is_business_follow_user?: boolean }>(igsid, {
      query: { fields: "name,username,is_user_follow_business,is_business_follow_user" },
    });
  }

  /** Returns the connected account's id and username. */
  me() {
    return this.request<{ id: string; user_id: string; username: string }>("me", {
      query: { fields: "id,user_id,username" },
    });
  }

  /** Subscribes the account to webhook fields so Meta starts sending comment notifications. */
  subscribeToWebhooks(igUserId: string, fields: string[] = ["comments", "messages"]) {
    return this.request<{ success: boolean }>(`${igUserId}/subscribed_apps`, {
      method: "POST",
      query: { subscribed_fields: fields.join(",") },
    });
  }

  /** Lists recent media so the dashboard can offer a post picker. */
  listMedia(igUserId: string, limit = 25) {
    return this.request<{ data: Array<{ id: string; caption?: string; media_type: string; permalink: string; timestamp: string; thumbnail_url?: string; media_url?: string }> }>(
      `${igUserId}/media`,
      { query: { fields: "id,caption,media_type,permalink,timestamp,thumbnail_url,media_url", limit: String(limit) } },
    );
  }
}

/* ---------- OAuth helpers (Instagram Login) ---------- */

export const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
];

export function buildAuthorizeUrl(appId: string, redirectUri: string, state: string): string {
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCodeForToken(
  params: { appId: string; appSecret: string; redirectUri: string; code: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ access_token: string; user_id: string; permissions?: string[] }> {
  const form = new URLSearchParams({
    client_id: params.appId,
    client_secret: params.appSecret,
    grant_type: "authorization_code",
    redirect_uri: params.redirectUri,
    code: params.code,
  });
  const res = await fetchImpl("https://api.instagram.com/oauth/access_token", { method: "POST", body: form });
  const json = await res.json();
  if (!res.ok) throw new InstagramApiError(json?.error_message ?? "Token exchange failed", res.status, undefined, undefined, json);
  return json;
}

export async function exchangeForLongLivedToken(
  params: { appSecret: string; shortLivedToken: string; apiVersion?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ access_token: string; token_type: string; expires_in: number }> {
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", params.appSecret);
  url.searchParams.set("access_token", params.shortLivedToken);
  const res = await fetchImpl(url.toString());
  const json = await res.json();
  if (!res.ok) throw new InstagramApiError(json?.error?.message ?? "Long-lived token exchange failed", res.status, undefined, undefined, json);
  return json;
}

export async function refreshLongLivedToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ access_token: string; token_type: string; expires_in: number }> {
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", token);
  const res = await fetchImpl(url.toString());
  const json = await res.json();
  if (!res.ok) throw new InstagramApiError(json?.error?.message ?? "Token refresh failed", res.status, undefined, undefined, json);
  return json;
}
