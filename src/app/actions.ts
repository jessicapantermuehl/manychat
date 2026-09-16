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
  return {
    name: String(form.get("name") ?? "").trim() || "Untitled automation",
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
    intentDescription: String(form.get("intentDescription") ?? "").trim(),
    aiFaq: String(form.get("aiFaq") ?? "").trim(),
  };
}

export async function saveAutomation(form: FormData) {
  const id = String(form.get("id") ?? "").trim() || undefined;
  const data = parseForm(form);
  if (!data.igUserId) throw new Error("Choose an Instagram account first.");
  if (!data.dmText) throw new Error("The DM text is required.");
  if (data.collectEmail && !data.emailPrompt) throw new Error("Write the message that asks for the email.");
  await getStore().upsertAutomation({ ...data, id });
  revalidatePath("/");
  redirect("/?saved=1");
}

export async function toggleAutomation(form: FormData) {
  const id = String(form.get("id") ?? "");
  const store = getStore();
  const existing = await store.getAutomation(id);
  if (!existing) return;
  await store.upsertAutomation({ ...existing, active: !existing.active });
  revalidatePath("/");
}

export async function deleteAutomation(form: FormData) {
  const id = String(form.get("id") ?? "");
  await getStore().deleteAutomation(id);
  revalidatePath("/");
  redirect("/?deleted=1");
}

export async function saveSettings(form: FormData) {
  const igUserId = String(form.get("igUserId") ?? "").trim();
  if (!igUserId) throw new Error("Choose an account.");
  await getStore().upsertSettings({
    igUserId,
    voiceSamples: String(form.get("voiceSamples") ?? "").trim(),
    brandNotes: String(form.get("brandNotes") ?? "").trim(),
  });
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

/** Drafts the copy for a new automation with Claude, then opens the form pre-filled. */
export async function generateAutomationCopy(form: FormData) {
  const ai = getAi();
  if (!ai) throw new Error("Set ANTHROPIC_API_KEY to enable AI copy generation.");
  const igUserId = String(form.get("igUserId") ?? "").trim();
  const offer = String(form.get("offer") ?? "").trim();
  const keyword = String(form.get("keyword") ?? "").trim();
  const link = String(form.get("dmLink") ?? "").trim();
  const mediaId = String(form.get("mediaId") ?? "").trim();
  if (!offer) throw new Error("Describe what you are giving away.");

  const voice = igUserId ? await getStore().getSettings(igUserId) : null;
  const copy = await ai.generateCopy({ offer, keyword, link, voice });

  const params = new URLSearchParams({
    igUserId,
    mediaId,
    name: offer.slice(0, 60),
    keywords: keyword,
    publicReplies: copy.publicReplies.join("\n"),
    dmText: copy.dmText,
    emailPrompt: copy.emailPrompt,
    dmLink: link,
    intentDescription: `someone asking for ${offer.slice(0, 120)}`,
  });
  redirect(`/automations/new?${params.toString()}`);
}
