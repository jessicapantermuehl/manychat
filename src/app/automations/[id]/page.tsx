import { notFound } from "next/navigation";
import { AutomationForm } from "@/components/AutomationForm";
import { env } from "@/lib/env";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function EditAutomationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const store = getStore();
  const [automation, accounts] = await Promise.all([store.getAutomation(id), store.listAccounts()]);
  if (!automation) notFound();

  return (
    <>
      <header className="top">
        <h1>Edit automation</h1>
        <a className="btn secondary" href="/">Cancel</a>
      </header>
      {query.error && <div className="notice bad">Could not save: {query.error}</div>}
      {query.copied && <div className="notice ok">This is a copy, saved as paused. Change the name, keyword and link, tick Active, then save.</div>}
      {query.mediaId && <div className="notice ok">Post selected. Click “Save automation” to apply it.</div>}
      <section className="card">
        <AutomationForm automation={query.mediaId ? { ...automation, mediaId: query.mediaId } : automation} accounts={accounts} envIgUserId={env.igUserId} />
      </section>
    </>
  );
}
