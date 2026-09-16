import { describe, expect, it, vi } from "vitest";
import type { Ai } from "../ai";
import { InstagramClient } from "../instagram";
import { handleCommentEvent, handleMessageEvent } from "../runner";
import { MemoryStore } from "../store";
import type { Automation, CommentEvent, MessageEvent } from "../types";

function fakeInstagram() {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ recipient_id: "igsid-42", message_id: "m1" }), { status: 200 });
  }) as unknown as typeof fetch;
  return { client: new InstagramClient("token", { fetchImpl }), calls };
}

function fakeAi(overrides: Partial<Ai> = {}): Ai & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    classifyIntent: async (comment, candidates) => {
      calls.push(`intent:${comment}`);
      return /need|want|send/i.test(comment) ? candidates[0]?.id ?? null : null;
    },
    triageComment: async (comment) => {
      calls.push(`triage:${comment}`);
      return { category: /\?/.test(comment) ? "question" : "lead", suggestedReply: `Reply to: ${comment}` };
    },
    answerFromFaq: async (question, faq) => {
      calls.push(`faq:${question}`);
      return faq.includes("free") && /free/i.test(question) ? "Yes, it's completely free." : null;
    },
    generateCopy: async () => ({ publicReplies: ["a", "b", "c"], dmText: "dm {{link}}", emailPrompt: "email {{username}}?", optInPrompt: "want it {{username}}?" }),
    ...overrides,
  };
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
  dmText: "Here: {{link}}",
  dmLink: "https://example.com/guide",
  dmButtonTitle: null,
  ignoreReplies: true,
  active: true,
  collectEmail: false,
  emailPrompt: "",
  emailRetryText: "Just the email please",
  ghlTags: [],
  deliverByEmailOnly: false,
  emailSentText: "",
  intentDescription: "someone asking for the gut health guide",
  aiFaq: "",
  requireOptIn: false,
  optInPrompt: "",
  optInButton: "",
};

const comment = (text: string): CommentEvent => ({
  igUserId: "acct",
  commentId: `c-${text}`,
  text,
  fromId: "fan1",
  fromUsername: "fan",
  mediaId: "m1",
  mediaProductType: "REELS",
  parentId: null,
  time: Math.floor(Date.now() / 1000),
});

const dm = (text: string): MessageEvent => ({ igUserId: "acct", senderId: "igsid-42", messageId: `mid-${text}`, text, payload: null, timestamp: Date.now() });

describe("AI intent matching", () => {
  it("fires the automation when the comment expresses the intent without the keyword", async () => {
    const store = new MemoryStore([rule]);
    const ig = fakeInstagram();
    const ai = fakeAi();
    const result = await handleCommentEvent(comment("omg I need this!!"), { store, clientFor: async () => ig.client, ai: () => ai });

    expect(result.status).toBe("sent");
    expect(result.detail).toContain("matched by AI intent");
    expect(ig.calls).toHaveLength(1);
    expect(ai.calls).toContain("intent:omg I need this!!");
  });

  it("does not call the AI when a keyword already matched", async () => {
    const store = new MemoryStore([rule]);
    const ig = fakeInstagram();
    const ai = fakeAi();
    await handleCommentEvent(comment("guide please"), { store, clientFor: async () => ig.client, ai: () => ai });
    expect(ai.calls.some((c) => c.startsWith("intent:"))).toBe(false);
  });

  it("skips intent matching for rules without a description, and never DMs on praise", async () => {
    const store = new MemoryStore([{ ...rule, intentDescription: "" }]);
    const ig = fakeInstagram();
    const ai = fakeAi();
    const result = await handleCommentEvent(comment("I need this"), { store, clientFor: async () => ig.client, ai: () => ai });
    expect(result.status).toBe("skipped");
    expect(ig.calls).toHaveLength(0);

    const praise = await handleCommentEvent(comment("so beautiful"), { store: new MemoryStore([rule]), clientFor: async () => ig.client, ai: () => ai });
    expect(praise.status).toBe("skipped");
    expect(ig.calls).toHaveLength(0);
  });

  it("falls back to keyword-only behaviour when the AI throws", async () => {
    const store = new MemoryStore([rule]);
    const ig = fakeInstagram();
    const ai = fakeAi({
      classifyIntent: async () => {
        throw new Error("boom");
      },
      triageComment: async () => {
        throw new Error("boom");
      },
    });
    const result = await handleCommentEvent(comment("I need this"), { store, clientFor: async () => ig.client, ai: () => ai });
    expect(result.status).toBe("skipped");
    expect(result.category).toBeUndefined();
  });
});

describe("AI triage", () => {
  it("labels every comment and stores a suggested reply", async () => {
    const store = new MemoryStore([rule]);
    const ig = fakeInstagram();
    const ai = fakeAi();
    const result = await handleCommentEvent(comment("does this help with bloating?"), { store, clientFor: async () => ig.client, ai: () => ai });
    expect(result.category).toBe("question");
    expect(result.suggestedReply).toBe("Reply to: does this help with bloating?");
    const [logged] = await store.listActivity(1);
    expect(logged.category).toBe("question");
  });

  it("runs without triage when no AI is configured", async () => {
    const store = new MemoryStore([rule]);
    const ig = fakeInstagram();
    const result = await handleCommentEvent(comment("guide"), { store, clientFor: async () => ig.client });
    expect(result.status).toBe("sent");
    expect(result.category).toBeUndefined();
  });
});

describe("AI FAQ answers during email capture", () => {
  const emailRule: Automation = { ...rule, collectEmail: true, emailPrompt: "What's your email?", aiFaq: "Is it free? Yes, completely free." };

  it("answers from the FAQ, re-asks for the email, and allows one extra attempt", async () => {
    const store = new MemoryStore([emailRule]);
    const ig = fakeInstagram();
    const ai = fakeAi();
    const deps = { store, clientFor: async () => ig.client, ai: () => ai };
    await handleCommentEvent(comment("guide"), deps);

    const first = await handleMessageEvent(dm("is it free?"), deps);
    expect(first?.detail).toBe("answered from FAQ and asked for email again");
    const sent = (ig.calls.at(-1)?.body as { message: { text: string } }).message.text;
    expect(sent).toBe("Yes, it's completely free.\n\nJust the email please");

    const second = await handleMessageEvent(dm("what will you do with it?"), deps);
    expect(second?.detail).toBe("asked for email again");

    const third = await handleMessageEvent(dm("hmm"), deps);
    expect(third?.status).toBe("skipped");
    expect((await store.getConversation("acct", "igsid-42"))?.state).toBe("abandoned");
  });

  it("never answers when the FAQ is empty", async () => {
    const store = new MemoryStore([{ ...emailRule, aiFaq: "" }]);
    const ig = fakeInstagram();
    const ai = fakeAi();
    const deps = { store, clientFor: async () => ig.client, ai: () => ai };
    await handleCommentEvent(comment("guide"), deps);
    const first = await handleMessageEvent(dm("is it free?"), deps);
    expect(first?.detail).toBe("asked for email again");
    expect(ai.calls.some((c) => c.startsWith("faq:"))).toBe(false);
  });
});

describe("AI failures are visible in the log", () => {
  it("appends the triage error to the detail instead of hiding it", async () => {
    const store = new MemoryStore([rule]);
    const ig = fakeInstagram();
    const ai = fakeAi({
      triageComment: async () => {
        throw Object.assign(new Error("invalid x-api-key"), { name: "AuthenticationError", status: 401 });
      },
    });
    const result = await handleCommentEvent(comment("guide"), { store, clientFor: async () => ig.client, ai: () => ai });
    expect(result.status).toBe("sent");
    expect(result.detail).toContain("AI triage failed: invalid x-api-key (HTTP 401)");
  });
});
