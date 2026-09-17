import { AutomationForm } from "@/components/AutomationForm";
import { env } from "@/lib/env";
import { getStore } from "@/lib/store";
import type { Automation } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NewAutomationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const accounts = await getStore().listAccounts();

  // Pre-fill from the post picker or the AI copy generator (query string).
  const has = Object.keys(params).some((k) => ["mediaId", "dmText", "publicReplies"].includes(k) && params[k]);
  const preset: Automation | undefined = has
    ? {
        id: "",
        name: params.name ?? "",
        offerName: params.offerName ?? "",
        igUserId: params.igUserId ?? "",
        mediaId: params.mediaId ?? null,
        keywords: (params.keywords ?? "").split(",").map((k) => k.trim()).filter(Boolean),
        matchMode: "contains",
        publicReplies: params.publicReplies ? params.publicReplies.split("\n") : ["Sent it to your DMs! 💌", "Check your inbox 📩", "Just sent you the link! ✨"],
        dmText: params.dmText ?? "Sure thing, {{username}}! Here's your {{offer}}:",
        dmLink: params.dmLink ?? null,
        dmButtonTitle: null,
        ignoreReplies: true,
        active: true,
        collectEmail: false,
        emailPrompt: params.emailPrompt ?? "",
        emailRetryText: "",
        ghlTags: [],
        deliverByEmailOnly: false,
        emailSentText: "",
        followUpMessages: [],
        intentDescription: params.intentDescription ?? "",
        aiFaq: "",
        requireOptIn: true,
        optInPrompt: params.optInPrompt ?? "",
        optInButton: "",
      }
    : undefined;

  return (
    <>
      <header className="top">
        <h1>New automation</h1>
        <div className="actions">
          <a className="btn secondary" href="/automations/generate">Draft with AI</a>
          <a className="btn secondary" href="/">Back</a>
        </div>
      </header>
      {params.error && <div className="notice bad">Could not save: {params.error}</div>}
      <section className="card">
        <AutomationForm accounts={accounts} envIgUserId={env.igUserId} automation={preset} />
      </section>
    </>
  );
}
