import { deleteAutomation, toggleAutomation } from "./actions";
import { env, hasSupabase } from "@/lib/env";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const store = getStore();
  const [automations, accounts, activity] = await Promise.all([store.listAutomations(), store.listAccounts(), store.listActivity(30)]);

  const webhookUrl = env.appUrl ? `${env.appUrl}/api/instagram/webhook` : "/api/instagram/webhook";

  return (
    <>
      <header className="top">
        <div>
          <h1>ConvertlySocial</h1>
          <div className="muted">Instagram comment → DM automations</div>
        </div>
        <div className="actions">
          <a className="btn secondary" href="/api/instagram/connect">Connect Instagram</a>
          <a className="btn" href="/automations/new">New automation</a>
        </div>
      </header>

      {params.connected && <div className="notice ok">Connected @{params.connected}. Webhooks are subscribed.</div>}
      {params.saved && <div className="notice ok">Automation saved.</div>}
      {params.deleted && <div className="notice ok">Automation deleted.</div>}
      {params.error && <div className="notice bad">Error: {params.error}</div>}
      {!hasSupabase() && (
        <div className="notice bad">
          No database configured: automations live in memory (or AUTOMATIONS_JSON) and will reset on each deploy. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for persistence.
        </div>
      )}

      <section className="card">
        <h2>Connected accounts</h2>
        {accounts.length === 0 && !env.accessToken && <p className="muted">No account yet. Click “Connect Instagram” (needs a Business or Creator account).</p>}
        {accounts.length === 0 && env.accessToken && <p className="muted">Using the access token from the environment (INSTAGRAM_ACCESS_TOKEN) for account {env.igUserId || "(id not set)"}.</p>}
        {accounts.length > 0 && (
          <table>
            <thead>
              <tr><th>Username</th><th>IG user id</th><th>Token expires</th><th>Posts</th></tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.igUserId}>
                  <td>@{a.username}</td>
                  <td><code>{a.igUserId}</code></td>
                  <td>{a.tokenExpiresAt ? new Date(a.tokenExpiresAt).toLocaleDateString() : "—"}</td>
                  <td><a href={`/media/${a.igUserId}`}>Pick a post</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted" style={{ marginTop: 12 }}>
          Webhook URL for the Meta app dashboard: <code>{webhookUrl}</code>
        </p>
      </section>

      <section className="card">
        <h2>Automations</h2>
        {automations.length === 0 && <p className="muted">None yet. Create one to start turning comments into DMs.</p>}
        {automations.length > 0 && (
          <table>
            <thead>
              <tr><th>Name</th><th>Trigger</th><th>Scope</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {automations.map((a) => (
                <tr key={a.id}>
                  <td><a href={`/automations/${a.id}`}>{a.name}</a></td>
                  <td>{a.keywords.length ? a.keywords.map((k) => <code key={k} style={{ marginRight: 4 }}>{k}</code>) : <span className="muted">any comment</span>}</td>
                  <td>{a.mediaId ? <code>{a.mediaId}</code> : <span className="muted">all posts</span>}</td>
                  <td><span className={`pill ${a.active ? "on" : "off"}`}>{a.active ? "Active" : "Paused"}</span></td>
                  <td>
                    <div className="actions">
                      <form action={toggleAutomation}>
                        <input type="hidden" name="id" value={a.id} />
                        <button className="btn secondary" type="submit">{a.active ? "Pause" : "Resume"}</button>
                      </form>
                      <form action={deleteAutomation}>
                        <input type="hidden" name="id" value={a.id} />
                        <button className="btn danger" type="submit">Delete</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Recent activity</h2>
        {activity.length === 0 && <p className="muted">Nothing yet. Comment on one of your posts with a trigger keyword to test.</p>}
        {activity.length > 0 && (
          <table>
            <thead>
              <tr><th>When</th><th>From</th><th>Comment</th><th>Result</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {activity.map((r) => (
                <tr key={r.id ?? r.commentId}>
                  <td className="muted">{r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}</td>
                  <td>@{r.fromUsername}</td>
                  <td>{r.commentText}</td>
                  <td><span className={`pill ${r.status}`}>{r.status}</span></td>
                  <td className="muted">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
