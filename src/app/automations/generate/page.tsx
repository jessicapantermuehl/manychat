import { generateAutomationCopy } from "@/app/actions";
import { env, hasAi } from "@/lib/env";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Describe the offer; Claude drafts the replies, DM and email prompt in your voice. */
export default async function GeneratePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const store = getStore();
  const accounts = await store.listAccounts();
  const defaultAccount = params.igUserId ?? accounts[0]?.igUserId ?? env.igUserId;
  const settings = defaultAccount ? await store.getSettings(defaultAccount) : null;

  return (
    <>
      <header className="top">
        <div><h1>Draft with AI</h1><div className="sub">Describe the giveaway; Claude writes the replies, DM and email prompt in your voice.</div></div>
        <a className="btn secondary" href="/automations/new">Back</a>
      </header>
      {!hasAi() && <div className="notice bad">Set ANTHROPIC_API_KEY in Vercel to use this.</div>}
      {!settings?.voiceSamples && (
        <div className="notice bad">
          No voice samples yet. The draft will sound generic. <a href="/settings">Add a few captions in settings</a> first for copy that sounds like you.
        </div>
      )}
      <section className="card">
        <form action={generateAutomationCopy} className="stack">
          <div className="row">
            <label>
              Instagram account
              <select name="igUserId" defaultValue={defaultAccount}>
                {accounts.map((a) => (
                  <option key={a.igUserId} value={a.igUserId}>@{a.username}</option>
                ))}
                {accounts.length === 0 && env.igUserId && <option value={env.igUserId}>env token account</option>}
              </select>
            </label>
          </div>
          <div className="row">
            <label>
              Name of the resource
              <input type="text" name="offerName" placeholder="Healthy Home Guide" />
              <span className="help">Exactly as it should read in a message.</span>
            </label>
            <label>
              Keyword
              <input type="text" name="keyword" placeholder="GUIDE" />
            </label>
          </div>
          <label>
            What is it, and who is it for?
            <textarea name="offer" required rows={4} placeholder="A free PDF for women who want to cut the toxins hiding in everyday household products, room by room." />
          </label>
          <div className="row">
            <label>
              Link
              <input type="url" name="dmLink" placeholder="https://..." />
            </label>
            <label>
              Post / Reel ID (optional)
              <input type="text" name="mediaId" defaultValue={params.mediaId ?? ""} />
            </label>
          </div>
          <div className="actions">
            <button className="btn" type="submit" disabled={!hasAi()}>Draft it</button>
            <span className="muted">Takes a few seconds. You can edit everything before saving.</span>
          </div>
        </form>
      </section>
    </>
  );
}
