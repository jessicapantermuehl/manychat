import { describe, expect, it, vi } from "vitest";
import { InstagramClient } from "../instagram";
import { handleCommentEvent, handleMessageEvent, OPT_IN_YES } from "../runner";
import { MemoryStore } from "../store";
import type { AccountSettings, Automation, CommentEvent, MessageEvent } from "../types";

function fakeInstagram() {
  const calls: Array<{ body: { recipient?: unknown; message?: { text?: string; attachment?: { payload: { text: string; buttons: Array<{ type: string; title: string; url?: string }> } } } } }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("fields=name%2Cusername")) return new Response(JSON.stringify({ id: "igsid-42", username: "fan" }), { status: 200 });
    calls.push({ body: init?.body ? JSON.parse(String(init.body)) : {} });
    return new Response(JSON.stringify({ recipient_id: "igsid-42", message_id: "m1" }), { status: 200 });
  }) as unknown as typeof fetch;
  return { client: new InstagramClient("token", { fetchImpl }), calls };
}

const rule: Automation = {
  id: "r1", triggers: ["comment"], name: "Guide", offerName: "Guide", igUserId: "acct", mediaId: null, keywords: ["guide"], matchMode: "contains",
  publicReplies: [], dmText: "Here: {{link}}", dmLink: "https://example.com/g", dmButtonTitle: null, ignoreReplies: true, active: true,
  collectEmail: false, emailPrompt: "", emailRetryText: "", ghlTags: [], deliverByEmailOnly: false, emailSentText: "", followUpMessages: [],
  intentDescription: "", aiFaq: "", requireOptIn: true, optInPrompt: "Want it?", optInButton: "Yes", requireFollow: false, followPrompt: "",
};
const settings: AccountSettings = {
  igUserId: "acct", voiceSamples: "", brandNotes: "",
  autoReplyEnabled: true, autoReplyScope: "automation", autoReplyText: "Hey {{username}}! I don't always see every message, so here are two places that help.",
  autoReplyButtons: [{ title: "Take the quiz", url: "https://example.com/quiz" }, { title: "My website", url: "https://example.com" }],
  autoReplyCooldownDays: 7,
};
const comment: CommentEvent = { igUserId: "acct", commentId: "c1", text: "guide", fromId: "fan1", fromUsername: "fan", mediaId: "m1", mediaProductType: "REELS", parentId: null, time: Math.floor(Date.now() / 1000) };
const msg = (over: Partial<MessageEvent>): MessageEvent => ({ igUserId: "acct", senderId: "igsid-42", messageId: `mid-${Math.random()}`, text: "", payload: null, storyReplyId: null, storyMention: false, timestamp: Date.now(), ...over });

async function finishedFlow(store: MemoryStore, client: InstagramClient) {
  const deps = { store, clientFor: async () => client };
  await handleCommentEvent(comment, deps);
  await handleMessageEvent(msg({ payload: OPT_IN_YES }), deps);
  return deps;
}

describe("default reply", () => {
  it("answers a thank-you after the flow with the message and link buttons, once", async () => {
    const store = new MemoryStore([rule]);
    await store.upsertSettings(settings);
    const ig = fakeInstagram();
    const deps = await finishedFlow(store, ig.client);

    const r = await handleMessageEvent(msg({ text: "Thank you! Just ordered it 🥰" }), deps);
    expect(r?.detail).toBe("default reply sent");
    const sent = ig.calls.at(-1)!.body.message!.attachment!.payload;
    expect(sent.text).toBe("Hey fan! I don't always see every message, so here are two places that help.");
    expect(sent.buttons).toEqual([
      { type: "web_url", title: "Take the quiz", url: "https://example.com/quiz" },
      { type: "web_url", title: "My website", url: "https://example.com" },
    ]);

    const before = ig.calls.length;
    expect(await handleMessageEvent(msg({ text: "one more thing" }), deps)).toBeNull();
    expect(ig.calls.length).toBe(before);
  });

  it("stays silent for strangers unless the scope is anyone", async () => {
    const store = new MemoryStore([rule]);
    await store.upsertSettings(settings);
    const ig = fakeInstagram();
    const deps = { store, clientFor: async () => ig.client };
    expect(await handleMessageEvent(msg({ text: "hi there" }), deps)).toBeNull();
    expect(ig.calls).toHaveLength(0);

    await store.upsertSettings({ ...settings, autoReplyScope: "anyone" });
    const r = await handleMessageEvent(msg({ text: "hi there" }), deps);
    expect(r?.detail).toBe("default reply sent");
  });

  it("never fires for taps, stop words, matched triggers, or when disabled", async () => {
    const store = new MemoryStore([{ ...rule, triggers: ["comment", "dm"] }]);
    await store.upsertSettings(settings);
    const ig = fakeInstagram();
    const deps = await finishedFlow(store, ig.client);

    const matched = await handleMessageEvent(msg({ text: "guide again" }), deps);
    expect(matched?.detail).toBe("DM keyword trigger; link sent");

    const before = ig.calls.length;
    expect(await handleMessageEvent(msg({ payload: "SOMETHING" }), deps)).toBeNull();
    const stop = await handleMessageEvent(msg({ text: "stop" }), deps);
    expect(stop?.detail).toContain("asked to stop");
    expect(await handleMessageEvent(msg({ text: "hello?" }), deps)).toBeNull();
    expect(ig.calls.length).toBe(before);

    await store.upsertSettings({ ...settings, autoReplyEnabled: false });
    const store2 = new MemoryStore([rule]);
    await store2.upsertSettings({ ...settings, autoReplyEnabled: false });
    const ig2 = fakeInstagram();
    const deps2 = await finishedFlow(store2, ig2.client);
    const n = ig2.calls.length;
    expect(await handleMessageEvent(msg({ text: "thanks" }), deps2)).toBeNull();
    expect(ig2.calls.length).toBe(n);
  });

  it("sends long text first and the buttons underneath", async () => {
    const store = new MemoryStore([rule]);
    await store.upsertSettings({ ...settings, autoReplyText: "x".repeat(700) });
    const ig = fakeInstagram();
    const deps = await finishedFlow(store, ig.client);
    await handleMessageEvent(msg({ text: "thanks" }), deps);
    const last2 = ig.calls.slice(-2).map((c) => c.body.message!);
    expect(last2[0].text?.length).toBe(700);
    expect(last2[1].attachment?.payload.text).toBe("Quick links:");
  });

  it("respects the cooldown and sends again once it has passed", async () => {
    const store = new MemoryStore([rule]);
    await store.upsertSettings({ ...settings, autoReplyCooldownDays: 0 });
    const ig = fakeInstagram();
    const deps = await finishedFlow(store, ig.client);
    await handleMessageEvent(msg({ text: "thanks" }), deps);
    const again = await handleMessageEvent(msg({ text: "thanks again" }), deps);
    expect(again?.detail).toBe("default reply sent");
  });
});
