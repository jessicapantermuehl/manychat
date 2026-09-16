import { AutomationForm } from "@/components/AutomationForm";
import { env } from "@/lib/env";
import { getStore } from "@/lib/store";
import type { Automation } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NewAutomationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const accounts = await getStore().listAccounts();

  // When arriving from the post picker, pre-fill the account and media id.
  const preset: Automation | undefined = params.mediaId
    ? {
        id: "",
        name: "",
        igUserId: params.igUserId ?? "",
        mediaId: params.mediaId,
        keywords: [],
        matchMode: "contains",
        publicReplies: ["Sent it to your DMs! 💌", "Check your inbox 📩", "Just sent you the link! ✨"],
        dmText: "Hey {{username}}! Here's the link you asked for: {{link}}",
        dmLink: null,
        dmButtonTitle: null,
        ignoreReplies: true,
        active: true,
        collectEmail: false,
        emailPrompt: "",
        emailRetryText: "",
        ghlTags: [],
      }
    : undefined;

  return (
    <>
      <header className="top">
        <h1>New automation</h1>
        <a className="btn secondary" href="/">Back</a>
      </header>
      <section className="card">
        <AutomationForm accounts={accounts} envIgUserId={env.igUserId} automation={preset} />
      </section>
    </>
  );
}
