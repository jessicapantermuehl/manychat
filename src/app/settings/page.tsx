import { saveSettings } from "@/app/actions";
import { env, hasAi } from "@/lib/env";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Voice samples and brand notes that every AI feature uses. */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const store = getStore();
  const accounts = await store.listAccounts();
  const igUserId = params.igUserId ?? accounts[0]?.igUserId ?? env.igUserId;
  const settings = igUserId ? await store.getSettings(igUserId) : null;

  return (
    <>
      <header className="top">
        <div><h1>Voice &amp; AI</h1><div className="sub">Paste how you write; every AI feature matches it.</div></div>
        <a className="btn secondary" href="/">Cancel</a>
      </header>
      {params.saved && <div className="notice ok">Saved.</div>}
      {!hasAi() && <div className="notice bad">ANTHROPIC_API_KEY is not set, so the AI features are off. These settings are kept for when it is.</div>}
      <section className="card">
        <form action={saveSettings} className="stack">
          <label>
            Instagram account
            <select name="igUserId" defaultValue={igUserId}>
              {accounts.map((a) => (
                <option key={a.igUserId} value={a.igUserId}>@{a.username}</option>
              ))}
              {accounts.length === 0 && env.igUserId && <option value={env.igUserId}>env token account</option>}
            </select>
          </label>
          <label>
            Voice samples
            <textarea
              name="voiceSamples"
              rows={10}
              defaultValue={settings?.voiceSamples ?? ""}
              placeholder="Paste 3 to 5 captions or DMs you have written. The AI copies this tone when it drafts replies and answers."
            />
          </label>
          <label>
            Brand notes
            <textarea
              name="brandNotes"
              rows={5}
              defaultValue={settings?.brandNotes ?? ""}
              placeholder="Who your audience is, words you never use, how formal to be, anything else the AI should know."
            />
          </label>
          <div className="actions">
            <button className="btn" type="submit">Save</button>
          </div>
        </form>
      </section>
    </>
  );
}
