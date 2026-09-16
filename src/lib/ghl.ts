/**
 * Minimal GoHighLevel (LeadConnector) API v2 client.
 * Docs: https://highlevel.stoplight.io/docs/integrations
 *
 * Auth uses a Private Integration token (GHL → Settings → Private integrations) with the
 * contacts.write scope. The Version header is required by the v2 API.
 */

export class GhlApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "GhlApiError";
  }
}

export interface GhlLead {
  email: string;
  /** Instagram username, stored as the first name when nothing better is known. */
  username?: string;
  tags?: string[];
  source?: string;
}

export interface GhlClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  version?: string;
}

export class GhlClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly version: string;

  constructor(
    private readonly apiKey: string,
    private readonly locationId: string,
    opts: GhlClientOptions = {},
  ) {
    this.base = (opts.baseUrl ?? "https://services.leadconnectorhq.com").replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.version = opts.version ?? "2021-07-28";
  }

  private async request<T>(path: string, body: unknown, method = "POST"): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        version: this.version,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      const msg = (json as { message?: string | string[] })?.message;
      throw new GhlApiError(Array.isArray(msg) ? msg.join("; ") : msg ?? `GoHighLevel error (${res.status})`, res.status, json);
    }
    return json as T;
  }

  /** Creates the contact or updates the one matching the email. Does not touch tags. */
  upsertContact(lead: GhlLead) {
    return this.request<{ contact: { id: string }; new: boolean }>("/contacts/upsert", {
      locationId: this.locationId,
      email: lead.email,
      ...(lead.username ? { firstName: lead.username } : {}),
      source: lead.source ?? "ConvertlySocial",
    });
  }

  /** Adds tags without removing the ones the contact already has. */
  addTags(contactId: string, tags: string[]) {
    return this.request<{ tags: string[] }>(`/contacts/${contactId}/tags`, { tags });
  }

  /** Upsert + tag in one call. Returns the GHL contact id. */
  async syncLead(lead: GhlLead): Promise<{ contactId: string; created: boolean }> {
    const result = await this.upsertContact(lead);
    const contactId = result.contact.id;
    const tags = (lead.tags ?? []).map((t) => t.trim()).filter(Boolean);
    if (tags.length > 0) await this.addTags(contactId, tags);
    return { contactId, created: Boolean(result.new) };
  }
}
