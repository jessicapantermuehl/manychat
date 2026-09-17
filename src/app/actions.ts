"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getStore } from "@/lib/store";
import { getAi } from "@/lib/ai";
import type { Automation } from "@/lib/types";

function lines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Paragraph-separated messages: one message per block, blank line between blocks. */
function paragraphs(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function commaList(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseForm(form: FormData): Omit<Automation, "id" | "createdAt"> {
  const dmLink = String(form.get("dmLink") ?? "").trim();
  const dmButtonTitle = String(form.get("dmButtonTitle") ?? "").trim();
  const mediaId = String(form.get("mediaId") ?? "").trim();
  const triggers = (form.getAll("triggers").map(String).filter((t) => ["comment", "story_reply", "story_mention", "dm"].includes(t)) as Automation["triggers"]);
  return {
    triggers: triggers.length ? triggers : ["comment"],
    name: String(form.get("name") ?? "").trim() || "Untitled automation",
    offerName: String(form.get("offerName") ?? "").trim(),
    igUserId: String(form.get("igUserId") ?? "").trim(),
    mediaId: mediaId || null,
    keywords: commaList(form.get("keywords")),
    matchMode: form.get("matchMode") === "exact" ? "exact" : "contains",
    publicReplies: lines(form.get("publicReplies")),
    dmText: String(form.get("dmText") ?? "").trim(),
    dmLink: dmLink || null,
    dmButtonTitle: dmButtonTitle || null,
    ignoreReplies: form.get("ignoreReplies") === "on",
    active: form.get("active") === "on",
    collectEmail: form.get("collectEmail") === "on",
    emailPrompt: String(form.get("emailPrompt") ?? "").trim(),
    emailRetryText: String(form.get("emailRetryText") ?? "").trim(),
    ghlTags: commaList(form.get("ghlTags")),
    deliverByEmailOnly: form.get("deliverByEmailOnly") === "on",
    emailSentText: String(form.get("emailSentText") ?? "").trim(),
    followUpMessages: paragraphs(form.get("followUpMessages")),
    intentDescription: String(form.get("intentDescription") ?? "").trim(),
    aiFaq: String(form.get("aiFaq") ?? "").trim(),
    requireOptIn: form.get("requireOptIn") === "on",
    optInPrompt: String(form.get("optInPrompt") ?? "").trim(),
    optInButton: String(form.get("optInButton") ?? "").trim().slice(0, 20),
    requireFollow: form.get("requireFollow") === "on",
    followPrompt: String(form.get("followPrompt") ?? "").trim(),
  };
}

/**
 * Server actions never throw to the browser: in production Next.js would replace the page with a
 * blank "client-side exception" screen. Instead every action redirects back with ?error=<message>.
 */
function describe(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const e = err as { message: string; code?: string; details?: string; hint?: string };
    return [e.message, e.details, e.hint].filter(Boolean).join(" ");
  }
  return String(err);
}

function withError(path: string, message: string): string {
  const url = new URL(path, "http://x");
  url.searchParams.set("error", message.slice(0, 300));
  return `${url.pathname}${url.search}`;
}

export async function saveAutomation(form: FormData) {
  const id = String(form.get("id") ?? "").trim() || undefined;
  const back = id ? `/automations/${id}` : "/automations/new";
  let failure: string | null = null;
  try {
    const data = parseForm(form);
    if (!data.igUserId) throw new Error("Choose an Instagram account first.");
    if (!data.dmText) throw new Error("The DM text is required.");
    if (data.collectEmail && !data.emailPrompt) throw new Error("Write the message that asks for the email.");
    if (data.triggers.includes("dm") && data.keywords.length === 0 && !data.intentDescription) {
      throw new Error("A DM trigger needs at least one keyword or an intent description, otherwise every message in your inbox would fire it.");
    }
    await getStore().upsertAutomation({ ...data, id });
    revalidatePath("/");
  } catch (err) {
    failure = describe(err);
  }
  if (failure) redirect(withError(back, failure));
  redirect("/?saved=1");
}

export async function toggleAutomation(form: FormData) {
  const id = String(form.get("id") ?? "");
  let failure: string | null = null;
  try {
    const store = getStore();
    const existing = await store.getAutomation(id);
    if (existing) await store.upsertAutomation({ ...existing, active: !existing.active });
    revalidatePath("/");
  } catch (err) {
    failure = describe(err);
  }
  if (failure) redirect(withError("/", failure));
}

export async function deleteAutomation(form: FormData) {
  const id = String(form.get("id") ?? "");
  let failure: string | null = null;
  try {
    await getStore().deleteAutomation(id);
    revalidatePath("/");
  } catch (err) {
    failure = describe(err);
  }
  if (failure) redirect(withError("/", failure));
  redirect("/?deleted=1");
}

export async function saveSettings(form: FormData) {
  const igUserId = String(form.get("igUserId") ?? "").trim();
  let failure: string | null = null;
  try {
    if (!igUserId) throw new Error("Choose an account.");
    await getStore().upsertSettings({
      igUserId,
      voiceSamples: String(form.get("voiceSamples") ?? "").trim(),
      brandNotes: String(form.get("brandNotes") ?? "").trim(),
    });
    revalidatePath("/settings");
  } catch (err) {
    failure = describe(err);
  }
  if (failure) redirect(withError("/settings", failure));
  redirect("/settings?saved=1");
}

/** Drafts the copy for a new automation with Claude, then opens the form pre-filled. */
export async function generateAutomationCopy(form: FormData) {
  const igUserId = String(form.get("igUserId") ?? "").trim();
  const offer = String(form.get("offer") ?? "").trim();
  const offerName = String(form.get("offerName") ?? "").trim();
  const keyword = String(form.get("keyword") ?? "").trim();
  const link = String(form.get("dmLink") ?? "").trim();
  const mediaId = String(form.get("mediaId") ?? "").trim();

  let copy: Awaited<ReturnType<NonNullable<ReturnType<typeof getAi>>["generateCopy"]>> | null = null;
  let failure: string | null = null;
  try {
    const ai = getAi();
    if (!ai) throw new Error("Set ANTHROPIC_API_KEY to enable AI copy generation.");
    if (!offer) throw new Error("Describe what you are giving away.");
    const voice = igUserId ? await getStore().getSettings(igUserId) : null;
    copy = await ai.generateCopy({ offer: offerName ? `${offerName}: ${offer}` : offer, keyword, link, voice });
  } catch (err) {
    failure = describe(err);
  }
  if (failure || !copy) redirect(withError("/automations/generate", failure ?? "No copy was generated."));

  const params = new URLSearchParams({
    igUserId,
    mediaId,
    name: offerName || offer.slice(0, 60),
    offerName,
    keywords: keyword,
    publicReplies: copy.publicReplies.join("\n"),
    dmText: copy.dmText,
    emailPrompt: copy.emailPrompt,
    optInPrompt: copy.optInPrompt,
    dmLink: link,
    intentDescription: `someone asking for ${offer.slice(0, 120)}`,
  });
  redirect(`/automations/new?${params.toString()}`);
}
