import { describe, expect, it } from "vitest";
import { findAutomation, keywordMatches, renderTemplate } from "../matching";
import type { Automation, CommentEvent } from "../types";

describe("keywordMatches", () => {
  it("matches case-insensitively and ignores surrounding punctuation", () => {
    expect(keywordMatches("GUIDE!!", ["guide"], "contains")).toBe(true);
    expect(keywordMatches("Can I get the guide please 🙏", ["guide"], "contains")).toBe(true);
  });

  it("requires whole-word matches in contains mode", () => {
    expect(keywordMatches("I linked it", ["link"], "contains")).toBe(false);
    expect(keywordMatches("send the link", ["link"], "contains")).toBe(true);
  });

  it("supports emoji keywords", () => {
    expect(keywordMatches("🔥🔥", ["🔥"], "contains")).toBe(true);
    expect(keywordMatches("love this ❤️", ["❤️"], "contains")).toBe(true);
  });

  it("exact mode only matches the whole comment", () => {
    expect(keywordMatches("guide", ["guide"], "exact")).toBe(true);
    expect(keywordMatches("Guide!", ["guide"], "exact")).toBe(true);
    expect(keywordMatches("the guide", ["guide"], "exact")).toBe(false);
  });

  it("matches everything when there are no keywords", () => {
    expect(keywordMatches("anything at all", [], "contains")).toBe(true);
  });

  it("strips accents", () => {
    expect(keywordMatches("Café por favor", ["cafe"], "contains")).toBe(true);
  });
});

function automation(overrides: Partial<Automation>): Automation {
  return {
    id: "a",
    name: "test",
    igUserId: "acct",
    mediaId: null,
    keywords: ["guide"],
    matchMode: "contains",
    publicReplies: [],
    dmText: "hi",
    dmLink: null,
    dmButtonTitle: null,
    ignoreReplies: true,
    active: true,
    ...overrides,
  };
}

const event: CommentEvent = {
  igUserId: "acct",
  commentId: "c1",
  text: "guide",
  fromId: "user1",
  fromUsername: "someone",
  mediaId: "m1",
  mediaProductType: "REELS",
  parentId: null,
  time: Math.floor(Date.now() / 1000),
};

describe("findAutomation", () => {
  it("prefers a post-specific rule over an account-wide one", () => {
    const wide = automation({ id: "wide" });
    const scoped = automation({ id: "scoped", mediaId: "m1" });
    expect(findAutomation(event, [wide, scoped])?.id).toBe("scoped");
  });

  it("ignores inactive rules, other accounts and other posts", () => {
    expect(findAutomation(event, [automation({ active: false })])).toBeNull();
    expect(findAutomation(event, [automation({ igUserId: "other" })])).toBeNull();
    expect(findAutomation(event, [automation({ mediaId: "m2" })])).toBeNull();
  });

  it("skips replies when ignoreReplies is on", () => {
    const reply = { ...event, parentId: "c0" };
    expect(findAutomation(reply, [automation({ ignoreReplies: true })])).toBeNull();
    expect(findAutomation(reply, [automation({ ignoreReplies: false })])).not.toBeNull();
  });
});

describe("renderTemplate", () => {
  it("replaces placeholders", () => {
    expect(renderTemplate("Hey {{username}} → {{ link }}", { username: "jess", link: "https://x.y" })).toBe("Hey jess → https://x.y");
  });
});
