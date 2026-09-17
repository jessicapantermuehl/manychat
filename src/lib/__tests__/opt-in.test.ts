import { describe, expect, it, vi } from "vitest";
import { InstagramClient } from "../instagram";
import { handleCommentEvent, handleMessageEvent, OPT_IN_NO, OPT_IN_YES } from "../runner";
import { MemoryStore } from "../store";
import type { Automation, CommentEvent, MessageEvent } from "../types";
import { looksLikeNo, looksLikeYes, parseMessageEvents } from "../webhook";

function fakeInstagram() {
  const calls: Array<{ url: string; body: { recipient: unknown; message: { text?: string; quick_replies?: Array<{ title: string; payload: string }> } } }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ recipient_id: "igsid-42", message_id: "m1" }), { status: 200 });
  }) as unknown as typeof fetch;
  return { client: new InstagramClient("token", { fetchImpl }), calls };
}

const rule: Automation = {
  id: "r1",
  name: "Gut guide",
  offerName: "Gut Guide",
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
  emailPrompt: "What's your email?",
  emailRetryText: "Just the email please",
  ghlTags: [],
  deliverByEmailOnly: false,
  emailSentText: "",
  followUpMessages: [],
  intentDescription: "",
  aiFaq: "",
  requireOptIn: true,
  optInPrompt: "Hey {{username}}, want the guide?",
  optInButton: "Yes please!",
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

const tap = (payload: string, id = `tap-${payload}-${Math.random()}`): MessageEvent => ({ igUserId: "acct", senderId: "igsid-42", messageId: id, text: "", payload, timestamp: Date.now() });
const dm = (text: string): MessageEvent => ({ igUserId: "acct", senderId: "igsid-42", messageId: `mid-${text}-${Math.random()}`, text, payload: null, timestamp: Date.now() });

describe("opt-in flow", () => {
  it("the private reply is only the opt-in question with a single Yes quick reply", async () => {
    const store = new MemoryStore([rule]);
    const ig = fakeInstagram();
    const result = await handleCommentEvent(comment, { store, clientFor: async () => ig.client });

    expect(result.status).toBe("sent");
    expect(result.detail).toBe("asked for opt-in");
    expect(ig.calls).toHaveLength(1);
    const msg = ig.calls[0].body.message;
    expect(ig.calls[0].body.recipient).toEqual({ comment_id: "c1" });
    expect(msg.text).toBe("Hey fan, want the guide?");
    expect(msg.quick_replies).toEqual([{ content_type: "text", title: "Yes please!", payload: OPT_IN_YES }]);
    expect((await store.getConversation("acct", "igsid-42"))?.state).toBe("awaiting_optin");
  });

  it("sends the link only after the Yes tap, as a normal message in the open window", async () => {
    const store = new MemoryStore([rule]);
    const ig = fakeInstagram();
    const deps = { store, clientFor: async () => ig.client };
    await handleCommentEvent(comment, deps);

    const result = await handleMessageEvent(tap(OPT_IN_YES), deps);
    expect(result?.detail).toBe("opted in; link sent");
    const last = ig.calls.at(-1)!.body;
    expect(last.recipient).toEqual({ id: "igsid-42" });
    expect(last.message.text).toBe("Here fan: https://example.com/guide");
    expect((await store.getConversation("acct", "igsid-42"))?.state).toBe("done");
  });

  it("a typed yes counts too", async () => {
    const store = new MemoryStore([rule]);
    const ig = fakeInstagram();
    const deps = { store, clientFor: async () => ig.client };
    await handleCommentEvent(comment, deps);
    const result = await handleMessageEvent(dm("Yes please!! 🙏"), deps);
    expect(result?.detail).toBe("opted in; link sent");
  });

  it("a typed 'no' or 'stop' (or a legacy No tap) closes the conversation without sending anything", async () => {
    for (const reply of [tap(OPT_IN_NO), dm("no thanks"), dm("STOP")]) {
      const store = new MemoryStore([rule]);
      const ig = fakeInstagram();
      const deps = { store, clientFor: async () => ig.client };
      await handleCommentEvent(comment, deps);
      const before = ig.calls.length;
      const result = await handleMessageEvent(reply, deps);
      expect(result?.status).toBe("skipped");
      expect(result?.detail).toMatch(/declined|asked to stop/);
      expect(ig.calls.length).toBe(before);
      expect((await store.getConversation("acct", "igsid-42"))?.state).toBe("abandoned");
    }
  });

  it("asks once more on an unclear reply, then goes quiet", async () => {
    const store = new MemoryStore([rule]);
    const ig = fakeInstagram();
    const deps = { store, clientFor: async () => ig.client };
    await handleCommentEvent(comment, deps);

    const first = await handleMessageEvent(dm("what is this?"), deps);
    expect(first?.detail).toBe("asked for opt-in again");
    expect(ig.calls.at(-1)!.body.message.quick_replies).toHaveLength(1);

    const second = await handleMessageEvent(dm("hm"), deps);
    expect(second?.status).toBe("skipped");
    expect((await store.getConversation("acct", "igsid-42"))?.state).toBe("abandoned");

    const third = await handleMessageEvent(tap(OPT_IN_YES), deps);
    expect(third).toBeNull();
  });

  it("with email capture on, Yes leads to the email question, then the link", async () => {
    const store = new MemoryStore([{ ...rule, collectEmail: true }]);
    const ig = fakeInstagram();
    const deps = { store, clientFor: async () => ig.client };
    await handleCommentEvent(comment, deps);

    const yes = await handleMessageEvent(tap(OPT_IN_YES), deps);
    expect(yes?.detail).toBe("opted in; asked for email");
    expect(ig.calls.at(-1)!.body.message.text).toBe("What's your email?");

    const captured = await handleMessageEvent(dm("fan@example.com"), deps);
    expect(captured?.status).toBe("captured");
    expect(ig.calls.at(-1)!.body.message.text).toBe("Here fan: https://example.com/guide");
  });

  it("stop words are honoured during the email step as well", async () => {
    const store = new MemoryStore([{ ...rule, collectEmail: true }]);
    const ig = fakeInstagram();
    const deps = { store, clientFor: async () => ig.client };
    await handleCommentEvent(comment, deps);
    await handleMessageEvent(tap(OPT_IN_YES), deps);
    const result = await handleMessageEvent(dm("unsubscribe"), deps);
    expect(result?.detail).toBe("asked to stop; conversation closed");
  });

  it("ignores a redelivered webhook for the same message", async () => {
    const store = new MemoryStore([rule]);
    const ig = fakeInstagram();
    const deps = { store, clientFor: async () => ig.client };
    await handleCommentEvent(comment, deps);
    const same = tap(OPT_IN_YES, "mid-dup");
    await handleMessageEvent(same, deps);
    const again = await handleMessageEvent(same, deps);
    expect(again).toBeNull();
    expect(ig.calls).toHaveLength(2);
  });

  it("without opt-in the old behaviour remains: the private reply carries the link", async () => {
    const store = new MemoryStore([{ ...rule, requireOptIn: false }]);
    const ig = fakeInstagram();
    const result = await handleCommentEvent(comment, { store, clientFor: async () => ig.client });
    expect(result.detail).toBe("DM sent");
    expect(ig.calls[0].body.message.text).toContain("https://example.com/guide");
  });
});

describe("yes / no detection", () => {
  it("recognises common affirmatives and refusals", () => {
    for (const t of ["yes", "YES!!", "yes please", "yep", "sure", "ok", "send it", "👍"]) expect(looksLikeYes(t), t).toBe(true);
    for (const t of ["no", "No thanks", "nope", "stop", "Unsubscribe", "not interested"]) expect(looksLikeNo(t), t).toBe(true);
    for (const t of ["what is it?", "how much", "fan@example.com"]) {
      expect(looksLikeYes(t), t).toBe(false);
      expect(looksLikeNo(t), t).toBe(false);
    }
  });
});

describe("parseMessageEvents with taps", () => {
  it("reads quick-reply payloads and postbacks", () => {
    const events = parseMessageEvents({
      object: "instagram",
      entry: [
        {
          id: "acct",
          time: 1,
          messaging: [
            { sender: { id: "u1" }, recipient: { id: "acct" }, timestamp: 1000, message: { mid: "m1", text: "Yes please!", quick_reply: { payload: OPT_IN_YES } } },
            { sender: { id: "u2" }, recipient: { id: "acct" }, timestamp: 2000, postback: { mid: "p1", title: "Yes", payload: OPT_IN_YES } },
          ],
        },
      ],
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ senderId: "u1", messageId: "m1", text: "Yes please!", payload: OPT_IN_YES });
    expect(events[1]).toMatchObject({ senderId: "u2", messageId: "p1", text: "Yes", payload: OPT_IN_YES });
  });
});

describe("changing their mind after No", () => {
  it("re-sends the opt-in question once after a typed no, then delivers on Yes", async () => {
    const store = new MemoryStore([rule]);
    const ig = fakeInstagram();
    const deps = { store, clientFor: async () => ig.client };
    await handleCommentEvent(comment, deps);
    await handleMessageEvent(dm("no"), deps);

    const oops = await handleMessageEvent(dm("wait, I do want it!"), deps);
    expect(oops?.detail).toBe("changed their mind; asked for opt-in again");
    expect(ig.calls.at(-1)!.body.message.quick_replies).toHaveLength(1);
    expect((await store.getConversation("acct", "igsid-42"))?.state).toBe("awaiting_optin");

    const yes = await handleMessageEvent(tap(OPT_IN_YES), deps);
    expect(yes?.detail).toBe("opted in; link sent");
  });

  it("only reopens once", async () => {
    const store = new MemoryStore([rule]);
    const ig = fakeInstagram();
    const deps = { store, clientFor: async () => ig.client };
    await handleCommentEvent(comment, deps);
    await handleMessageEvent(tap(OPT_IN_NO), deps);
    await handleMessageEvent(dm("oops actually yes"), deps);
    await handleMessageEvent(tap(OPT_IN_NO), deps);
    const before = ig.calls.length;
    const again = await handleMessageEvent(dm("oops actually yes"), deps);
    expect(again).toBeNull();
    expect(ig.calls.length).toBe(before);
  });

  it("never reopens after a stop word, and ignores unrelated chatter after a No", async () => {
    const store = new MemoryStore([rule]);
    const ig = fakeInstagram();
    const deps = { store, clientFor: async () => ig.client };
    await handleCommentEvent(comment, deps);
    await handleMessageEvent(dm("stop"), deps);
    expect(await handleMessageEvent(dm("actually yes please"), deps)).toBeNull();

    const store2 = new MemoryStore([rule]);
    const deps2 = { store: store2, clientFor: async () => ig.client };
    await handleCommentEvent(comment, deps2);
    await handleMessageEvent(tap(OPT_IN_NO), deps2);
    const before = ig.calls.length;
    expect(await handleMessageEvent(dm("love your reels btw"), deps2)).toBeNull();
    expect(ig.calls.length).toBe(before);
  });
});

describe("{{offer}} personalisation", () => {
  it("names the resource in the default opt-in question and in custom messages", async () => {
    const store = new MemoryStore([{ ...rule, optInPrompt: "", dmText: "Your {{offer}} is here {{username}}: {{link}}" }]);
    const ig = fakeInstagram();
    const deps = { store, clientFor: async () => ig.client };
    await handleCommentEvent(comment, deps);
    expect(ig.calls[0].body.message.text).toBe("Hey fan! Thanks so much for asking for the Gut Guide. Just to confirm, would you like me to send you the link?");
    await handleMessageEvent(tap(OPT_IN_YES), deps);
    expect(ig.calls.at(-1)!.body.message.text).toBe("Your Gut Guide is here fan: https://example.com/guide");
  });

  it("falls back to a generic question when no offer name is set", async () => {
    const store = new MemoryStore([{ ...rule, offerName: "", optInPrompt: "" }]);
    const ig = fakeInstagram();
    await handleCommentEvent(comment, { store, clientFor: async () => ig.client });
    expect(ig.calls[0].body.message.text).toBe("Hey fan! Just to confirm, would you like me to send you the link?");
  });
});

describe("link delivery", () => {
  it("appends the link when the DM text forgets the {{link}} placeholder", async () => {
    const store = new MemoryStore([{ ...rule, dmText: "Sure thing, here's your {{offer}}:" }]);
    const ig = fakeInstagram();
    const deps = { store, clientFor: async () => ig.client };
    await handleCommentEvent(comment, deps);
    await handleMessageEvent(tap(OPT_IN_YES), deps);
    expect(ig.calls.at(-1)!.body.message.text).toBe("Sure thing, here's your Gut Guide:\n\nhttps://example.com/guide");
  });

  it("does not append it when a button carries the link or the text already has it", async () => {
    const withButton = new MemoryStore([{ ...rule, dmText: "Tap below", dmButtonTitle: "Open" }]);
    const ig = fakeInstagram();
    const deps = { store: withButton, clientFor: async () => ig.client };
    await handleCommentEvent(comment, deps);
    await handleMessageEvent(tap(OPT_IN_YES), deps);
    const last = ig.calls.at(-1)!.body.message as { attachment?: { payload: { text: string } } };
    expect(last.attachment?.payload.text).toBe("Tap below");

    const withPlaceholder = new MemoryStore([{ ...rule, dmText: "Here: {{link}}" }]);
    const ig2 = fakeInstagram();
    const deps2 = { store: withPlaceholder, clientFor: async () => ig2.client };
    await handleCommentEvent(comment, deps2);
    await handleMessageEvent(tap(OPT_IN_YES), deps2);
    expect(ig2.calls.at(-1)!.body.message.text).toBe("Here: https://example.com/guide");
  });
});

describe("extra messages after the link", () => {
  it("sends them in order after the link, with placeholders filled", async () => {
    const store = new MemoryStore([{ ...rule, followUpMessages: ["Start with page 4, {{username}}.", "Questions about the {{offer}}? Reply here."] }]);
    const ig = fakeInstagram();
    const deps = { store, clientFor: async () => ig.client };
    await handleCommentEvent(comment, deps);
    const result = await handleMessageEvent(tap(OPT_IN_YES), deps);

    const texts = ig.calls.slice(1).map((c) => (c.body.message as { text: string }).text);
    expect(texts).toEqual(["Here fan: https://example.com/guide", "Start with page 4, fan.", "Questions about the Gut Guide? Reply here."]);
    expect(result?.detail).toBe("opted in; link sent; 2 follow-ups sent");
  });

  it("caps at three and notes when they cannot be sent without the opt-in step", async () => {
    const store = new MemoryStore([{ ...rule, followUpMessages: ["a", "b", "c", "d"] }]);
    const ig = fakeInstagram();
    const deps = { store, clientFor: async () => ig.client };
    await handleCommentEvent(comment, deps);
    await handleMessageEvent(tap(OPT_IN_YES), deps);
    expect(ig.calls).toHaveLength(1 + 1 + 3);

    const direct = new MemoryStore([{ ...rule, requireOptIn: false, followUpMessages: ["a"] }]);
    const ig2 = fakeInstagram();
    const r = await handleCommentEvent(comment, { store: direct, clientFor: async () => ig2.client });
    expect(r.detail).toContain("follow-ups skipped");
    expect(ig2.calls).toHaveLength(1);
  });
});
