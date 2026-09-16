import type { Automation, CommentEvent } from "./types";

/** Lower-cases, strips accents, and collapses whitespace so "Guide!!" matches "guide". */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Removes leading/trailing punctuation and emoji from a comment for exact-mode comparison. */
function stripEdges(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns true when the comment text triggers the given keywords.
 * - No keywords: matches everything.
 * - "contains": the keyword must appear as a whole word (so "link" does not match "linked").
 * - "exact": the whole comment (ignoring surrounding punctuation/emoji) must equal the keyword.
 */
export function keywordMatches(
  commentText: string,
  keywords: string[],
  mode: Automation["matchMode"],
): boolean {
  const cleaned = keywords.map((k) => normalize(k)).filter(Boolean);
  if (cleaned.length === 0) return true;

  const text = normalize(commentText);
  if (mode === "exact") {
    const core = stripEdges(text);
    return cleaned.some((k) => stripEdges(k) === core);
  }

  return cleaned.some((k) => {
    // Word boundary that also works for keywords containing emoji or punctuation.
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(k)}(?=$|[^\\p{L}\\p{N}])`, "u");
    return pattern.test(text);
  });
}

/**
 * Picks the automation that should handle a comment. Rules scoped to a specific post win over
 * account-wide rules, and among equals the first (oldest) one wins.
 */
export function findAutomation(event: CommentEvent, automations: Automation[]): Automation | null {
  const candidates = eligibleAutomations(event, automations).filter((a) => keywordMatches(event.text, a.keywords, a.matchMode));
  return pickPreferred(candidates);
}

/** Active rules for this account that apply to the comment's post and reply status, before keyword matching. */
export function eligibleAutomations(event: CommentEvent, automations: Automation[]): Automation[] {
  return automations.filter((a) => {
    if (!a.active) return false;
    if (a.igUserId !== event.igUserId) return false;
    if (a.mediaId && a.mediaId !== event.mediaId) return false;
    if (a.ignoreReplies && event.parentId) return false;
    return true;
  });
}

/** Post-specific rules win over account-wide ones; among equals the oldest wins. */
export function pickPreferred(candidates: Automation[]): Automation | null {
  if (candidates.length === 0) return null;
  return candidates.find((a) => a.mediaId) ?? candidates[0];
}

/** Replaces {{username}}, {{link}} and {{offer}} placeholders. */
export function renderTemplate(template: string, vars: { username: string; link: string; offer?: string }): string {
  return template
    .replace(/\{\{\s*username\s*\}\}/gi, vars.username)
    .replace(/\{\{\s*link\s*\}\}/gi, vars.link)
    .replace(/\{\{\s*offer\s*\}\}/gi, vars.offer ?? "");
}

export function pickRandom<T>(items: T[], random: () => number = Math.random): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(random() * items.length)];
}
