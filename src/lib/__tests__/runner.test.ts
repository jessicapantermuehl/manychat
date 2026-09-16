import { describe, expect, it, vi } from "vitest";
import { InstagramClient } from "../instagram";
import { handleCommentEvent } from "../runner";
import { MemoryStore } from "../store";
import type { Automation, CommentEvent } from "../types";

function makeClient() {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ id: "ok", message_id: "m" }), { status: 200 });
  }) as unknown as typeof fetch;
  return { client: new InstagramClient("token", { fetchImpl }), calls };
}

const rule: Automation = {
  id: "r1",
  name: "Guide",
  offerName: "",
  igUserId: "acct",
  mediaId: null,
  keywords: ["guide"],
  matchMode: "contains",
  publicReplies: ["Sent! 💌"],
  dmText: "Hey {{username}}, here: {{link}}",
  dmLink: "https://example.com/guide",
  dmButtonTitle: null,
  ignoreReplies: true,
  active: true,
  collectEmail: false,
  emailPrompt: "",
  emailRetryText: "",
  ghlTags: [],
  intentDescription: "",
  aiFaq: "",
  requireOptIn: false,
  optInPrompt: "",
  optInButton: "",
};

const event: CommentEvent = {
  igUserId: "acct",
  commentId: "c1",
  text: "Guide please!",
  fromId: "fan1",
  fromUsername: "fan",
  mediaId: "m1",
  mediaProductType: "FEED",
  parentId: null,
  time: Math.floor(Date.now() / 1000),
};

describe("handleCommentEvent", () => {
  it("replies publicly and sends the private reply DM", async () => {
    const store = new MemoryStore([rule]);
    const { client, calls } = makeClient();
    const result = await handleCommentEvent(event, { store, clientFor: async () => client, random: () => 0 });

    expect(result.status).toBe("sent");
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("/c1/replies");
    expect(calls[0].url).toContain("message=Sent");
    expect(calls[1].url).toContain("/acct/messages");
    expect(calls[1].body).toEqual({
      recipient: { comment_id: "c1" },
      message: { text: "Hey fan, here: https://example.com/guide" },
    });
  });

  it("sends a button template when a button title is set", async () => {
    const store = new MemoryStore([{ ...rule, dmButtonTitle: "Get it", publicReplies: [] }]);
    const { client, calls } = makeClient();
    await handleCommentEvent(event, { store, clientFor: async () => client });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({
      message: { attachment: { type: "template", payload: { template_type: "button", buttons: [{ type: "web_url", url: "https://example.com/guide", title: "Get it" }] } } },
    });
  });

  it("does not respond twice to the same comment", async () => {
    const store = new MemoryStore([rule]);
    const { client, calls } = makeClient();
    await handleCommentEvent(event, { store, clientFor: async () => client });
    const second = await handleCommentEvent(event, { store, clientFor: async () => client });
    expect(second.status).toBe("skipped");
    expect(second.detail).toBe("already handled");
    expect(calls).toHaveLength(2);
  });

  it("ignores the account's own comments", async () => {
    const store = new MemoryStore([rule]);
    const { client, calls } = makeClient();
    const result = await handleCommentEvent({ ...event, fromId: "acct" }, { store, clientFor: async () => client });
    expect(result.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("skips comments that match no rule", async () => {
    const store = new MemoryStore([rule]);
    const { client, calls } = makeClient();
    const result = await handleCommentEvent({ ...event, text: "beautiful!" }, { store, clientFor: async () => client });
    expect(result.status).toBe("skipped");
    expect(result.detail).toBe("no matching automation");
    expect(calls).toHaveLength(0);
  });

  it("records a failure when the DM cannot be sent", async () => {
    const store = new MemoryStore([{ ...rule, publicReplies: [] }]);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: "nope", code: 10 } }), { status: 400 })) as unknown as typeof fetch;
    const client = new InstagramClient("token", { fetchImpl });
    const result = await handleCommentEvent(event, { store, clientFor: async () => client });
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("nope");
    expect(await store.hasHandled("c1")).toBe(true);
  });

  it("fails clearly when no token exists for the account", async () => {
    const store = new MemoryStore([rule]);
    const result = await handleCommentEvent(event, { store, clientFor: async () => null });
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("no access token");
  });
});
