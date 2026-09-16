import { describe, expect, it, vi } from "vitest";
import { ClaudeAi } from "../ai";

/** Captures the request the SDK sends and returns a canned Messages API response. */
function mockTransport(jsonText: string, stopReason = "end_turn") {
  const requests: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit).forEach((v, k) => (headers[k] = v));
    requests.push({ url: String(input), headers, body: JSON.parse(String(init?.body)) });
    return new Response(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        content: [{ type: "text", text: jsonText }],
        stop_reason: stopReason,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

describe("ClaudeAi request shape", () => {
  it("sends a structured-output request with the fallback beta and low effort", async () => {
    const t = mockTransport(JSON.stringify({ automationId: "r1", confidence: "high" }));
    const ai = new ClaudeAi({ apiKey: "test", fetch: t.fetchImpl });
    const result = await ai.classifyIntent("I need that guide", [{ id: "r1", name: "Guide", intentDescription: "asks for the guide" }]);

    expect(result).toBe("r1");
    const req = t.requests[0];
    expect(req.url).toContain("/v1/messages");
    expect(req.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect(req.body.model).toBe("claude-opus-5");
    expect(req.body.fallbacks).toBe("default");
    expect((req.body.output_config as { effort: string }).effort).toBe("low");
    expect((req.body.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    expect(JSON.stringify(req.body.messages)).toContain("I need that guide");
  });

  it("returns null for low confidence or unknown ids", async () => {
    const low = new ClaudeAi({ apiKey: "test", fetch: mockTransport(JSON.stringify({ automationId: "r1", confidence: "low" })).fetchImpl });
    expect(await low.classifyIntent("hmm", [{ id: "r1", name: "Guide", intentDescription: "x" }])).toBeNull();
    const unknown = new ClaudeAi({ apiKey: "test", fetch: mockTransport(JSON.stringify({ automationId: "zzz", confidence: "high" })).fetchImpl });
    expect(await unknown.classifyIntent("hmm", [{ id: "r1", name: "Guide", intentDescription: "x" }])).toBeNull();
  });

  it("treats a refusal as no answer", async () => {
    const t = mockTransport("", "refusal");
    const ai = new ClaudeAi({ apiKey: "test", fetch: t.fetchImpl });
    expect(await ai.answerFromFaq("is it free?", "Is it free? Yes.", null)).toBeNull();
  });

  it("only answers from the FAQ when the model says it can", async () => {
    const yes = new ClaudeAi({ apiKey: "test", fetch: mockTransport(JSON.stringify({ canAnswer: true, answer: "Yes, it's free." })).fetchImpl });
    expect(await yes.answerFromFaq("free?", "Is it free? Yes.", null)).toBe("Yes, it's free.");
    const no = new ClaudeAi({ apiKey: "test", fetch: mockTransport(JSON.stringify({ canAnswer: false, answer: "" })).fetchImpl });
    expect(await no.answerFromFaq("what's your dog's name?", "Is it free? Yes.", null)).toBeNull();
  });

  it("includes voice samples in the system prompt for copy generation", async () => {
    const t = mockTransport(JSON.stringify({ publicReplies: ["a", "b", "c"], dmText: "d {{link}}", emailPrompt: "e {{username}}", optInPrompt: "o {{username}}" }));
    const ai = new ClaudeAi({ apiKey: "test", fetch: t.fetchImpl });
    const copy = await ai.generateCopy({ offer: "gut guide", keyword: "GUIDE", link: "https://x.y", voice: { voiceSamples: "hey friend, real talk", brandNotes: "no hype" } });
    expect(copy.publicReplies).toHaveLength(3);
    const system = JSON.stringify(t.requests[0].body.system);
    expect(system).toContain("hey friend, real talk");
    expect(system).toContain("no hype");
    expect(system).toContain("Never make medical");
  });
});
