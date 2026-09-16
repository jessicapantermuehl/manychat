import { notFound } from "next/navigation";
import { AutomationForm } from "@/components/AutomationForm";
import { env } from "@/lib/env";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function EditAutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getStore();
  const [automation, accounts] = await Promise.all([store.getAutomation(id), store.listAccounts()]);
  if (!automation) notFound();

  return (
    <>
      <header className="top">
        <h1>Edit automation</h1>
        <a className="btn secondary" href="/">Cancel</a>
      </header>
      <section className="card">
        <AutomationForm automation={automation} accounts={accounts} envIgUserId={env.igUserId} />
      </section>
    </>
  );
}
