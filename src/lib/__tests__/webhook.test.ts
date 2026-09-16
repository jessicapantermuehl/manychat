import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handleVerification, parseCommentEvents, verifySignature } from "../webhook";

const payload = {
  object: "instagram",
  entry: [
    {
      id: "17841400000000000",
      time: 1700000000,
      changes: [
        {
          field: "comments",
          value: {
            id: "17900000000000002",
            text: "GUIDE",
            from: { id: "555", username: "fan" },
            media: { id: "17900000000000001", media_product_type: "REELS" },
          },
        },
        { field: "mentions", value: { comment_id: "x", media_id: "y" } },
      ],
    },
  ],
};

describe("parseCommentEvents", () => {
  it("extracts comment events and ignores other fields", () => {
    const events = parseCommentEvents(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      igUserId: "17841400000000000",
      commentId: "17900000000000002",
      text: "GUIDE",
      fromId: "555",
      fromUsername: "fan",
      mediaId: "17900000000000001",
      parentId: null,
      time: 1700000000,
    });
  });

  it("returns nothing for non-instagram payloads", () => {
    expect(parseCommentEvents({ object: "page", entry: [] })).toEqual([]);
    expect(parseCommentEvents(null)).toEqual([]);
  });
});

describe("verifySignature", () => {
  const body = JSON.stringify(payload);
  const secret = "s3cret";
  const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

  it("accepts a valid signature", () => {
    expect(verifySignature(body, sig, secret)).toBe(true);
  });

  it("rejects tampered bodies, wrong secrets and missing headers", () => {
    expect(verifySignature(body + " ", sig, secret)).toBe(false);
    expect(verifySignature(body, sig, "other")).toBe(false);
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, "sha1=abc", secret)).toBe(false);
  });
});

describe("handleVerification", () => {
  it("returns the challenge when the token matches", () => {
    const params = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "12345" });
    expect(handleVerification(params, "tok")).toEqual({ ok: true, challenge: "12345" });
  });

  it("rejects mismatched tokens", () => {
    const params = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "12345" });
    expect(handleVerification(params, "tok")).toEqual({ ok: false });
  });
});
