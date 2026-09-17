import { describe, expect, it, vi } from "vitest";
import { InstagramClient } from "../instagram";
import { FOLLOW_DONE, handleCommentEvent, handleMessageEvent, OPT_IN_YES } from "../runner";
import { MemoryStore } from "../store";
import type { Automation, CommentEvent, MessageEvent } from "../types";
import { parseMessageEvents } from "../webhook";

/** Fake Instagram: records sends, answers profile lookups with a configurable follow status. */
function fakeInstagram(opts: { following?: boolean | "error"; username?: string } = {}) {
  const calls: Array<{ url: string; body: { recipient?: unknown; message?: { text?: string; attachment?: { payload: { text: string; buttons: Array<{ payload?: string }> } } } } | null }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("fields=name%2Cusername")) {
      if (opts.following === "error") return new Response(JSON.stringify({ error: { message: "no permission", code: 100 } }), { status: 400 });
      return new Response(JSON.stringify({ id: "igsid-42", username: opts.username ?? "fan", is_user_follow_business: opts.following ?? true }), { status: 200 });
    }
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ recipient_id: "igsid-42", message_id: "m1" }), { status: 200 });
  }) as unknown as typeof fetch;
  return { client: new InstagramClient("token", { fetchImpl }), calls, sentTexts: () => calls.map((c) => c.body?.message?.text ?? c.body?.message?.attachment?.payload.text ?? "") };
}

const base: Automation = {
  id: "r1",
  triggers: ["comment"],
  name: "Guide",
  offerName: "Guide",
  igUserId: "acct",
  mediaId: null,
  keywords: ["guide"],
  matchMode: "contains",
  publicReplies: [],
  dmText: "Here {{username}}: {{link}}",
  dmLink: "https://example.com/guide",
  dmButtonTitle: null,
  ignoreReplies: true,
  active: true,
  collectEmail: false,
  emailPrompt: "",
  emailRetryText: "",
  ghlTags: [],
  deliverByEmailOnly: false,
  emailSentText: "",
  followUpMessages: [],
  intentDescription: "",
  aiFaq: "",
  requireOptIn: true,
  optInPrompt: "Want it, {{username}}?",
  optInButton: "Yes please!",
  requireFollow: false,
  followPrompt: "",
};

const comment: CommentEvent = { igUserId: "acct", commentId: "c1", text: "guide", fromId: "fan1", fromUsername: "fan", mediaId: "m1", mediaProductType: "REELS", parentId: null, time: Math.floor(Date.now() / 1000) };
const msg = (over: Partial<MessageEvent>): MessageEvent => ({ igUserId: "acct", senderId: "igsid-42", messageId: `mid-${Math.random()}`, text: "", payload: null, storyReplyId: null, storyMention: false, timestamp: Date.now(), ...over });

describe("story reply and DM keyword triggers", () => {
  it("a story reply with the keyword delivers the link straight away, no opt-in", async () => {
    const store = new MemoryStore([{ ...base, triggers: ["comment", "story_reply"] }]);
    const ig = fakeInstagram();
    const r = await handleMessageEvent(msg({ text: "GUIDE please", storyReplyId: "story-9" }), { store, clientFor: async () => ig.client });
    expect(r?.status).toBe("sent");
    expect(r?.detail).toBe("story reply trigger; link sent");
    expect(ig.sentTexts()).toEqual(["Here fan: https://example.com/guide"]);
    expect((await store.getConversation("acct", "igsid-42"))?.state).toBe("done");
  });

  it("a keyword DM delivers too, but only when the automation has the DM trigger on", async () => {
    const off = new MemoryStore([base]);
    const ig1 = fakeInstagram();
    expect(await handleMessageEvent(msg({ text: "guide" }), { store: off, clientFor: async () => ig1.client })).toBeNull();
    expect(ig1.calls).toHaveLength(0);

    const on = new MemoryStore([{ ...base, triggers: ["dm"] }]);
    const ig2 = fakeInstagram();
    const r = await handleMessageEvent(msg({ text: "can I get the guide?" }), { store: on, clientFor: async () => ig2.client });
    expect(r?.detail).toBe("DM keyword trigger; link sent");
  });

  it("ignores DMs that do not contain a keyword, and never answers every message", async () => {
    const store = new MemoryStore([{ ...base, triggers: ["dm"] }]);
    const ig = fakeInstagram();
    expect(await handleMessageEvent(msg({ text: "hi! love your page" }), { store, clientFor: async () => ig.client })).toBeNull();
    expect(ig.calls).toHaveLength(0);
  });

  it("a story mention fires without any text", async () => {
    const store = new MemoryStore([{ ...base, triggers: ["story_mention"], keywords: [] }]);
    const ig = fakeInstagram();
    const r = await handleMessageEvent(msg({ storyMention: true }), { store, clientFor: async () => ig.client });
    expect(r?.detail).toBe("story mention trigger; link sent");
    expect(r?.commentText).toBe("[story mention]");
  });

  it("a finished conversation can be re-triggered by a new keyword, but a stop is final", async () => {
    const store = new MemoryStore([{ ...base, triggers: ["comment", "dm"] }]);
    const ig = fakeInstagram();
    const deps = { store, clientFor: async () => ig.client };
    await handleCommentEvent(comment, deps);
    await handleMessageEvent(msg({ payload: OPT_IN_YES }), deps);
    expect((await store.getConversation("acct", "igsid-42"))?.state).toBe("done");

    const again = await handleMessageEvent(msg({ text: "guide again pls" }), deps);
    expect(again?.detail).toBe("DM keyword trigger; link sent");

    await handleMessageEvent(msg({ text: "stop" }), deps);
    expect(await handleMessageEvent(msg({ text: "guide" }), deps)).toBeNull();
  });

  it("looks up the username for templates when the person never commented", async () => {
    const store = new MemoryStore([{ ...base, triggers: ["dm"] }]);
    const ig = fakeInstagram({ username: "storyfan" });
    const r = await handleMessageEvent(msg({ text: "guide" }), { store, clientFor: async () => ig.client });
    expect(r?.fromUsername).toBe("storyfan");
    expect(ig.sentTexts()[0]).toBe("Here storyfan: https://example.com/guide");
  });
});

describe("follow gate", () => {
  const gated: Automation = { ...base, requireFollow: true, followPrompt: "Follow me first, {{username}}!" };

  it("skips the gate for people who already follow", async () => {
    const store = new MemoryStore([gated]);
    const ig = fakeInstagram({ following: true });
    const deps = { store, clientFor: async () => ig.client };
    await handleCommentEvent(comment, deps);
    const r = await handleMessageEvent(msg({ payload: OPT_IN_YES }), deps);
    expect(r?.detail).toBe("opted in; already following; link sent");
  });

  it("asks non-followers to follow, then delivers once they do", async () => {
    const store = new MemoryStore([gated]);
    const notYet = fakeInstagram({ following: false });
    await handleCommentEvent(comment, { store, clientFor: async () => notYet.client });
    const asked = await handleMessageEvent(msg({ payload: OPT_IN_YES }), { store, clientFor: async () => notYet.client });
    expect(asked?.detail).toBe("opted in; asked to follow first");
    const prompt = notYet.calls.at(-1)!.body!.message!.attachment!.payload;
    expect(prompt.text).toBe("Follow me first, fan!");
    expect(prompt.buttons[0].payload).toBe(FOLLOW_DONE);
    expect((await store.getConversation("acct", "igsid-42"))?.state).toBe("awaiting_follow");

    const nowFollowing = fakeInstagram({ following: true });
    const done = await handleMessageEvent(msg({ payload: FOLLOW_DONE }), { store, clientFor: async () => nowFollowing.client });
    expect(done?.detail).toBe("now following; link sent");
    expect(nowFollowing.sentTexts()).toEqual(["Here fan: https://example.com/guide"]);
  });

  it("reminds once when they tap the button without following, then goes quiet", async () => {
    const store = new MemoryStore([gated]);
    const ig = fakeInstagram({ following: false });
    const deps = { store, clientFor: async () => ig.client };
    await handleCommentEvent(comment, deps);
    await handleMessageEvent(msg({ payload: OPT_IN_YES }), deps);
    const first = await handleMessageEvent(msg({ payload: FOLLOW_DONE }), deps);
    expect(first?.detail).toBe("not following yet; asked again");
    const second = await handleMessageEvent(msg({ payload: FOLLOW_DONE }), deps);
    expect(second?.status).toBe("skipped");
    expect((await store.getConversation("acct", "igsid-42"))?.state).toBe("abandoned");
  });

  it("fails open when Instagram cannot report follow status", async () => {
    const store = new MemoryStore([gated]);
    const ig = fakeInstagram({ following: "error" });
    const deps = { store, clientFor: async () => ig.client };
    await handleCommentEvent(comment, deps);
    const r = await handleMessageEvent(msg({ payload: OPT_IN_YES }), deps);
    expect(r?.detail).toBe("opted in; follow status unknown, skipped gate; link sent");
  });

  it("applies to story and DM triggers as well, and runs before the email step", async () => {
    const store = new MemoryStore([{ ...gated, triggers: ["dm"], collectEmail: true, emailPrompt: "Email?" }]);
    const ig = fakeInstagram({ following: false });
    const r = await handleMessageEvent(msg({ text: "guide" }), { store, clientFor: async () => ig.client });
    expect(r?.detail).toBe("DM keyword trigger; asked to follow first");
    const after = fakeInstagram({ following: true });
    const next = await handleMessageEvent(msg({ payload: FOLLOW_DONE }), { store, clientFor: async () => after.client });
    expect(next?.detail).toBe("now following; asked for email");
  });
});

describe("parseMessageEvents for stories", () => {
  it("reads story replies and story mentions", () => {
    const events = parseMessageEvents({
      object: "instagram",
      entry: [
        {
          id: "acct",
          time: 1,
          messaging: [
            { sender: { id: "u1" }, recipient: { id: "acct" }, timestamp: 1000, message: { mid: "m1", text: "GUIDE", reply_to: { story: { id: "s1", url: "https://cdn/x" } } } },
            { sender: { id: "u2" }, recipient: { id: "acct" }, timestamp: 2000, message: { mid: "m2", attachments: [{ type: "story_mention", payload: { url: "https://cdn/y" } }] } },
          ],
        },
      ],
    });
    expect(events[0]).toMatchObject({ senderId: "u1", text: "GUIDE", storyReplyId: "s1", storyMention: false });
    expect(events[1]).toMatchObject({ senderId: "u2", text: "", storyReplyId: null, storyMention: true });
  });
});
