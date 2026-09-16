import { describe, expect, it, vi } from "vitest";
import { GhlClient } from "../ghl";
import { InstagramClient } from "../instagram";
import { handleCommentEvent, handleMessageEvent } from "../runner";
import { MemoryStore } from "../store";
import type { Automation, CommentEvent, MessageEvent } from "../types";
import { extractEmail, parseMessageEvents } from "../webhook";

function fakeInstagram() {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ recipient_id: "igsid-42", message_id: "m1" }), { status: 200 });
  }) as unknown as typeof fetch;
  return { client: new InstagramClient("token", { fetchImpl }), calls };
}

function fakeGhl(opts: { fail?: boolean } = {}) {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> });
    if (opts.fail) return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
    if (url.endsWith("/contacts/upsert")) return new Response(JSON.stringify({ contact: { id: "ghl-1" }, new: true }), { status: 200 });
    return new Response(JSON.stringify({ tags: ["instagram"] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { client: new GhlClient("key", "loc-1", { fetchImpl }), calls };
}

const rule: Automation = {
  id: "r1",
  name: "Guide",
  igUserId: "acct",
  mediaId: null,
  keywords: ["guide"],
  matchMode: "contains",
  publicReplies: [],
  dmText: "Here you go {{username}}: {{link}}",
  dmLink: "https://example.com/guide",
  dmButtonTitle: null,
  ignoreReplies: true,
  active: true,
  collectEmail: true,
  emailPrompt: "Hey {{username}}, what's your email?",
  emailRetryText: "Just the email please",
  ghlTags: ["instagram", "guide"],
  intentDescription: "",
  aiFaq: "",
  requireOptIn: false,
  optInPrompt: "",
  optInButton: "",
};

const comment: CommentEvent = {
  igUserId: "acct",
  commentId: "c1",
  text: "guide",
  fromId: "fan1",
  fromUsername: "fan",
  mediaId: "m1",
  mediaProductType: "REELS",
  parentId: null,
  time: Math.floor(Date.now() / 1000),
};

const dm = (text: string): MessageEvent => ({ igUserId: "acct", senderId: "igsid-42", messageId: `mid-${text}`, text, payload: null, timestamp: Date.now() });

describe("email capture flow", () => {
  it("asks for the email first and remembers the conversation", async () => {
    const store = new MemoryStore([rule]);
    const ig = fakeInstagram();
    const result = await handleCommentEvent(comment, { store, clientFor: async () => ig.client });

    expect(result.status).toBe("sent");
    expect(result.detail).toBe("asked for email");
    expect(ig.calls[0].body).toEqual({ recipient: { comment_id: "c1" }, message: { text: "Hey fan, what's your email?" } });
    const convo = await store.getConversation("acct", "igsid-42");
    expect(convo?.state).toBe("awaiting_email");
  });

  it("pushes the email to GoHighLevel and then sends the link", async () => {
    const store = new MemoryStore([rule]);
    const ig = fakeInstagram();
    const ghl = fakeGhl();
    await handleCommentEvent(comment, { store, clientFor: async () => ig.client });

    const result = await handleMessageEvent(dm("sure! it's Fan.Person@Example.com"), { store, clientFor: async () => ig.client, ghlClient: () => ghl.client });

    expect(result?.status).toBe("captured");
    expect(result?.detail).toContain("GHL contact created");
    expect(ghl.calls[0].url).toBe("https://services.leadconnectorhq.com/contacts/upsert");
    expect(ghl.calls[0].headers.version).toBe("2021-07-28");
    expect(ghl.calls[0].body).toEqual({ locationId: "loc-1", email: "fan.person@example.com", firstName: "fan", source: "ConvertlySocial" });
    expect(ghl.calls[1].url).toBe("https://services.leadconnectorhq.com/contacts/ghl-1/tags");
    expect(ghl.calls[1].body).toEqual({ tags: ["instagram", "guide"] });

    const linkDm = ig.calls.at(-1)?.body as { recipient: unknown; message: unknown };
    expect(linkDm.recipient).toEqual({ id: "igsid-42" });
    expect(linkDm.message).toEqual({ text: "Here you go fan: https://example.com/guide" });

    const convo = await store.getConversation("acct", "igsid-42");
    expect(convo).toMatchObject({ state: "done", email: "fan.person@example.com", ghlContactId: "ghl-1" });
    expect(await store.listLeads()).toHaveLength(1);
  });

  it("still sends the link and keeps the email when GoHighLevel fails", async () => {
    const store = new MemoryStore([rule]);
    const ig = fakeInstagram();
    const ghl = fakeGhl({ fail: true });
    await handleCommentEvent(comment, { store, clientFor: async () => ig.client });
    const result = await handleMessageEvent(dm("me@site.org"), { store, clientFor: async () => ig.client, ghlClient: () => ghl.client });

    expect(result?.status).toBe("captured");
    expect(result?.detail).toContain("GHL sync failed: Unauthorized (HTTP 401)");
    expect((await store.getConversation("acct", "igsid-42"))?.email).toBe("me@site.org");
  });

  it("asks once more when the reply has no email, then closes the conversation", async () => {
    const store = new MemoryStore([rule]);
    const ig = fakeInstagram();
    const deps = { store, clientFor: async () => ig.client };
    await handleCommentEvent(comment, deps);

    const first = await handleMessageEvent(dm("why do you need that?"), deps);
    expect(first?.detail).toBe("asked for email again");
    expect((ig.calls.at(-1)?.body as { message: { text: string } }).message.text).toBe("Just the email please");

    const second = await handleMessageEvent(dm("no thanks"), deps);
    expect(second?.status).toBe("skipped");
    expect((await store.getConversation("acct", "igsid-42"))?.state).toBe("abandoned");

    const third = await handleMessageEvent(dm("ok fine a@b.co"), deps);
    expect(third).toBeNull();
  });

  it("ignores DMs from people we never asked", async () => {
    const store = new MemoryStore([rule]);
    const ig = fakeInstagram();
    const result = await handleMessageEvent(dm("hello"), { store, clientFor: async () => ig.client });
    expect(result).toBeNull();
    expect(ig.calls).toHaveLength(0);
  });
});

describe("extractEmail", () => {
  it("finds emails inside text and normalises them", () => {
    expect(extractEmail("It's Jess.Doe+ig@Gmail.com.")).toBe("jess.doe+ig@gmail.com");
    expect(extractEmail("no email here")).toBeNull();
  });
});

describe("parseMessageEvents", () => {
  const payload = {
    object: "instagram",
    entry: [
      {
        id: "acct",
        time: 1700000000,
        messaging: [
          { sender: { id: "igsid-42" }, recipient: { id: "acct" }, timestamp: 1700000000000, message: { mid: "m1", text: "me@x.io" } },
          { sender: { id: "acct" }, recipient: { id: "igsid-42" }, timestamp: 1700000001000, message: { mid: "m2", text: "echo", is_echo: true } },
        ],
      },
    ],
  };

  it("keeps inbound messages and drops echoes of our own", () => {
    const events = parseMessageEvents(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ igUserId: "acct", senderId: "igsid-42", messageId: "m1", text: "me@x.io" });
  });
});
