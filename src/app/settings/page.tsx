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
        <div><h1>Voice &amp; AI</h1><div className="sub">How you write, and what to say when someone messages outside a flow.</div></div>
        <a className="btn secondary" href="/">Cancel</a>
      </header>
      {params.error && <div className="notice bad">Could not save: {params.error}</div>}
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
          <fieldset className="group">
            <legend>Default reply (when someone messages and nothing else answers)</legend>
            <label className="check">
              <input type="checkbox" name="autoReplyEnabled" defaultChecked={settings?.autoReplyEnabled ?? false} />
              Send a default reply
            </label>
            <span className="help">
              Fires when a message isn't part of a running flow and matches no automation, for example “thank you!” after the link arrives. Sent at most once per person within the cooldown. Never sent to taps or to anyone who said stop.
            </span>
            <div className="row">
              <label>
                Who gets it
                <select name="autoReplyScope" defaultValue={settings?.autoReplyScope ?? "automation"}>
                  <option value="automation">Only people who came through an automation</option>
                  <option value="anyone">Anyone who DMs me</option>
                </select>
              </label>
              <label>
                Cooldown (days)
                <input type="text" name="autoReplyCooldownDays" defaultValue={String(settings?.autoReplyCooldownDays ?? 7)} />
                <span className="help">7 means one default reply per person per week.</span>
              </label>
            </div>
            <label>
              Message
              <textarea
                name="autoReplyText"
                rows={7}
                defaultValue={settings?.autoReplyText ?? ""}
                placeholder={"Hey! I get a lot of messages and don't always see every one, so here are a couple of places that might help in case I miss this.\n\nQuestions about an order? Email hello@holisticjessica.com.\n\nWant to ask me something directly? The Signal Snapshot quiz is the best place to start."}
              />
              <span className="help">Under 640 characters keeps the buttons attached to the message; longer text is sent first with the buttons underneath. {"{{username}}"} works here.</span>
            </label>
            <div className="row">
              <label>
                Button 1 title
                <input type="text" name="button1Title" maxLength={20} defaultValue={settings?.autoReplyButtons[0]?.title ?? ""} placeholder="Take the quiz" />
              </label>
              <label>
                Button 1 link
                <input type="url" name="button1Url" defaultValue={settings?.autoReplyButtons[0]?.url ?? ""} placeholder="https://..." />
              </label>
            </div>
            <div className="row">
              <label>
                Button 2 title
                <input type="text" name="button2Title" maxLength={20} defaultValue={settings?.autoReplyButtons[1]?.title ?? ""} placeholder="My website" />
              </label>
              <label>
                Button 2 link
                <input type="url" name="button2Url" defaultValue={settings?.autoReplyButtons[1]?.url ?? ""} placeholder="https://..." />
              </label>
            </div>
          </fieldset>

          <div className="actions">
            <button className="btn" type="submit">Save</button>
          </div>
        </form>
      </section>
    </>
  );
}
