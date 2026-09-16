/**
 * AI features, powered by Claude.
 *
 * Every function is deliberately narrow and guard-railed:
 * - intent matching only ever picks one of the automations you wrote (or none),
 * - FAQ answers only come from text you provided and never invent health claims,
 * - copy generation drafts text for you to review; nothing is sent automatically.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { env } from "./env";

export type TriageCategory = "lead" | "question" | "praise" | "spam" | "other";

export interface IntentCandidate {
  id: string;
  name: string;
  intentDescription: string;
}

export interface Triage {
  category: TriageCategory;
  suggestedReply: string;
}

export interface GeneratedCopy {
  publicReplies: string[];
  dmText: string;
  emailPrompt: string;
}

export interface VoiceProfile {
  /** A few examples of how the account owner writes (captions, DMs). */
  voiceSamples: string;
  /** Anything else worth knowing: audience, tone, words to avoid. */
  brandNotes: string;
}

export interface Ai {
  /** Returns the id of the automation whose intent the comment expresses, or null. */
  classifyIntent(comment: string, candidates: IntentCandidate[]): Promise<string | null>;
  /** Labels a comment and drafts a reply the owner could send by hand. */
  triageComment(comment: string, voice: VoiceProfile | null): Promise<Triage>;
  /** Answers a follower's question strictly from the FAQ, or returns null when it cannot. */
  answerFromFaq(question: string, faq: string, voice: VoiceProfile | null): Promise<string | null>;
  /** Drafts public replies, the DM and the email prompt for a new automation. */
  generateCopy(input: { offer: string; keyword: string; link: string; voice: VoiceProfile | null }): Promise<GeneratedCopy>;
}

const IntentResult = z.object({
  automationId: z.string().nullable().describe("The id of the single best matching automation, or null when the comment does not clearly ask for any of them."),
  confidence: z.enum(["high", "medium", "low"]),
});

const TriageResult = z.object({
  category: z.enum(["lead", "question", "praise", "spam", "other"]),
  suggestedReply: z.string().describe("A short reply the account owner could post under the comment. Empty string for spam."),
});

const FaqResult = z.object({
  canAnswer: z.boolean().describe("True only when the FAQ text directly answers the question."),
  answer: z.string().describe("The answer in the owner's voice, at most two sentences. Empty when canAnswer is false."),
});

const CopyResult = z.object({
  publicReplies: z.array(z.string()).min(3).max(5),
  dmText: z.string(),
  emailPrompt: z.string(),
});

const GUARDRAILS = `Rules that always apply:
- Never make medical, treatment or cure claims. Keep wellness language to general education and structure/function statements.
- Never promise results or outcomes.
- Never ask for anything other than an email address.
- Do not use em dashes.
- Keep messages short: Instagram DMs and comments are read on a phone.`;

function voiceBlock(voice: VoiceProfile | null): string {
  if (!voice || (!voice.voiceSamples.trim() && !voice.brandNotes.trim())) return "";
  return `\n\nHow the account owner writes (match this voice):\n<voice_samples>\n${voice.voiceSamples.trim()}\n</voice_samples>\n<brand_notes>\n${voice.brandNotes.trim()}\n</brand_notes>`;
}

export class ClaudeAi implements Ai {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(opts: { apiKey?: string; model?: string; fetch?: typeof fetch } = {}) {
    this.client = new Anthropic({ apiKey: opts.apiKey ?? env.anthropicApiKey, fetch: opts.fetch });
    this.model = opts.model ?? env.aiModel;
  }

  /**
   * One structured-output call. Returns null when the model declined (refusal) or the output
   * could not be parsed; API errors (auth, rate limit, network) are thrown so callers can log them.
   */
  private async parse<T extends z.ZodType>(args: { system: string; user: string; schema: T; maxTokens?: number; effort?: "low" | "medium" | "high" }): Promise<z.infer<T> | null> {
    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: args.maxTokens ?? 1024,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: args.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: args.user }],
        output_config: { effort: args.effort ?? "low", format: betaZodOutputFormat(args.schema) },
      });
      if (response.stop_reason === "refusal") return null;
      return (response.parsed_output as z.infer<T> | null) ?? null;
    } catch (err) {
      if (err instanceof Anthropic.APIError) throw err;
      // Unparsable output (for example an empty refusal body): treat as "no answer".
      return null;
    }
  }

  async classifyIntent(comment: string, candidates: IntentCandidate[]): Promise<string | null> {
    if (!comment.trim() || candidates.length === 0) return null;
    const list = candidates.map((c) => `- id: ${c.id}\n  name: ${c.name}\n  fires when: ${c.intentDescription}`).join("\n");
    const result = await this.parse({
      system: `You match Instagram comments to automations. You will be given a list of automations, each with a description of what a commenter is asking for when it should fire. Pick the one automation the comment clearly asks for. If the comment is general praise, a question unrelated to any automation, spam, or ambiguous between several automations, return null. Be conservative: a false match sends someone a DM they did not ask for.`,
      user: `<automations>\n${list}\n</automations>\n\n<comment>\n${comment.trim()}\n</comment>`,
      schema: IntentResult,
      maxTokens: 256,
    });
    if (!result?.automationId || result.confidence === "low") return null;
    return candidates.some((c) => c.id === result.automationId) ? result.automationId : null;
  }

  async triageComment(comment: string, voice: VoiceProfile | null): Promise<Triage> {
    const fallback: Triage = { category: "other", suggestedReply: "" };
    if (!comment.trim()) return fallback;
    const result = await this.parse({
      system: `You triage Instagram comments for a wellness creator. Categories:
- lead: the person wants something the creator offers (a guide, link, program, more info) or shows buying intent.
- question: a genuine question that deserves an answer.
- praise: compliments, emoji, agreement, "love this".
- spam: bots, promotions, follow-for-follow, unrelated links.
- other: anything else.
Then write the reply the creator could post under the comment. Keep it warm, one or two sentences, no hashtags. For spam, return an empty reply.${voiceBlock(voice)}\n\n${GUARDRAILS}`,
      user: `<comment>\n${comment.trim()}\n</comment>`,
      schema: TriageResult,
      maxTokens: 400,
    });
    return result ?? fallback;
  }

  async answerFromFaq(question: string, faq: string, voice: VoiceProfile | null): Promise<string | null> {
    if (!question.trim() || !faq.trim()) return null;
    const result = await this.parse({
      system: `You reply to a follower in an Instagram DM on behalf of the account owner, who has already asked the follower for their email address so a free resource can be sent. Answer the follower's message using ONLY the FAQ below. If the FAQ does not cover it, set canAnswer to false and leave the answer empty; do not guess and do not invent details. Never mention that you are an AI or that you have an FAQ. At most two sentences.

<faq>
${faq.trim()}
</faq>${voiceBlock(voice)}

${GUARDRAILS}`,
      user: `<follower_message>\n${question.trim()}\n</follower_message>`,
      schema: FaqResult,
      maxTokens: 400,
    });
    if (!result?.canAnswer || !result.answer.trim()) return null;
    return result.answer.trim();
  }

  async generateCopy(input: { offer: string; keyword: string; link: string; voice: VoiceProfile | null }): Promise<GeneratedCopy> {
    const result = await this.parse({
      system: `You write copy for an Instagram comment-to-DM automation. The creator posts content, tells people to comment a keyword, and an automation replies publicly and sends a DM. Write:
1. publicReplies: 3 to 5 short public replies posted under the comment (each under 80 characters, varied, may use one emoji, must tell the person to check their DMs).
2. dmText: the DM that delivers the resource. Use the placeholders {{username}} and {{link}} literally. Two or three sentences.
3. emailPrompt: a DM that asks for their email so the resource can be sent, using {{username}}. One or two sentences, friendly, low pressure.
Match the creator's voice closely.${voiceBlock(input.voice)}

${GUARDRAILS}`,
      user: `<offer>\n${input.offer.trim()}\n</offer>\n<keyword>${input.keyword.trim() || "the keyword"}</keyword>\n<link>${input.link.trim() || "(link will be added later)"}</link>`,
      schema: CopyResult,
      maxTokens: 1500,
      effort: "medium",
    });
    if (!result) throw new Error("Claude declined to generate copy for this request.");
    return result;
  }
}

let cached: Ai | null = null;

/** The configured AI, or null when ANTHROPIC_API_KEY is not set. */
export function getAi(): Ai | null {
  if (!env.anthropicApiKey) return null;
  if (!cached) cached = new ClaudeAi();
  return cached;
}
