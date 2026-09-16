"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getStore } from "@/lib/store";
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
