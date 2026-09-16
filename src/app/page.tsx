import { deleteAutomation, toggleAutomation } from "./actions";
import { env, hasAi, hasGhl, hasSupabase } from "@/lib/env";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function compact(n: number): string {
  return n >= 10000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString();
}

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const store = getStore();
  const [automations, accounts, activity, leads] = await Promise.all([
    store.listAutomations(),
    store.listAccounts(),
    store.listActivity(300),
    store.listLeads(100),
  ]);
  const emailRulesExist = automations.some((a) => a.collectEmail);
  const webhookUrl = env.appUrl ? `${env.appUrl}/api/instagram/webhook` : "/api/instagram/webhook";

  const since = Date.now() - WEEK_MS;
  const recent = activity.filter((r) => r.createdAt && Date.parse(r.createdAt) >= since);
  const stats = {
    comments: recent.length,
    dms: recent.filter((r) => r.status === "sent" || r.status === "captured").length,
    leads: leads.filter((l) => l.updatedAt && Date.parse(l.updatedAt) >= since).length,
    active: automations.filter((a) => a.active).length,
  };
  const feed = activity.slice(0, 30);

  return (
    <>
      <header className="top">
        <div>
          <h1>Dashboard</h1>
          <div className="sub">{accounts.length ? accounts.map((a) => `@${a.username}`).join(", ") : "No Instagram account connected yet"}</div>
        </div>
        <div className="actions">
          <a className="btn secondary" href="/automations/generate">Draft with AI</a>
          <a className="btn" href="/automations/new">New automation</a>
        </div>
      </header>

      {params.connected && <div className="notice ok">Connected @{params.connected}. Webhooks are subscribed.</div>}
      {params.saved && <div className="notice ok">Automation saved.</div>}
      {params.deleted && <div className="notice ok">Automation deleted.</div>}
      {params.error && <div className="notice bad">Error: {params.error}</div>}
      {!hasSupabase() && (
        <div className="notice bad">No database configured: automations live in memory and reset on each deploy. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.</div>
      )}
      {!hasAi() && <div className="notice bad">AI features are off. Set ANTHROPIC_API_KEY to enable intent matching, comment triage, FAQ answers and copy drafting.</div>}
      {emailRulesExist && !hasGhl() && (
        <div className="notice bad">An automation collects emails but GoHighLevel is not configured. Emails are still saved here; set GHL_API_KEY and GHL_LOCATION_ID to sync them.</div>
      )}

      <section className="stats" aria-label="Last 7 days">
        <div className="stat"><div className="label">Comments handled</div><div className="value">{compact(stats.comments)}</div><div className="delta">last 7 days</div></div>
        <div className="stat"><div className="label">DMs sent</div><div className="value">{compact(stats.dms)}</div><div className="delta">last 7 days</div></div>
        <div className="stat"><div className="label">Emails captured</div><div className="value">{compact(stats.leads)}</div><div className="delta">last 7 days</div></div>
        <div className="stat"><div className="label">Active automations</div><div className="value">{stats.active}</div><div className="delta">of {automations.length} total</div></div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Automations<span className="count">{automations.length}</span></h2>
          <a className="btn secondary sm" href="/automations/new">Add</a>
        </div>
        {automations.length === 0 && <div className="empty">No automations yet. Create one, or let AI draft the copy for you.</div>}
        {automations.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Trigger</th><th>Scope</th><th>Extras</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {automations.map((a) => (
                  <tr key={a.id}>
                    <td><a href={`/automations/${a.id}`}><strong>{a.name}</strong></a></td>
                    <td>{a.keywords.length ? a.keywords.map((k) => <code key={k} style={{ marginRight: 4 }}>{k}</code>) : <span className="muted">any comment</span>}</td>
                    <td>{a.mediaId ? <code>{a.mediaId}</code> : <span className="muted">all posts</span>}</td>
                    <td className="muted">{[a.collectEmail && "email", a.intentDescription && "intent", a.aiFaq && "FAQ", a.dmButtonTitle && "button"].filter(Boolean).join(" · ") || "—"}</td>
                    <td><span className={`pill ${a.active ? "on" : "off"}`}>{a.active ? "Active" : "Paused"}</span></td>
                    <td>
                      <div className="actions">
                        <form action={toggleAutomation}>
                          <input type="hidden" name="id" value={a.id} />
                          <button className="btn secondary sm" type="submit">{a.active ? "Pause" : "Resume"}</button>
                        </form>
                        <form action={deleteAutomation}>
                          <input type="hidden" name="id" value={a.id} />
                          <button className="btn danger sm" type="submit">Delete</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Recent activity<span className="count">{feed.length}</span></h2>
        </div>
        {feed.length === 0 && <div className="empty">Nothing yet. Comment a trigger keyword on one of your posts from another account to test.</div>}
        {feed.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>When</th><th>From</th><th>Comment</th><th>Type</th><th>Result</th><th>Detail</th><th>Suggested reply</th></tr>
              </thead>
              <tbody>
                {feed.map((r) => (
                  <tr key={r.id ?? r.commentId}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{r.createdAt ? new Date(r.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}</td>
                    <td style={{ whiteSpace: "nowrap" }}>@{r.fromUsername}</td>
                    <td><div className="wrap">{r.commentText}</div></td>
                    <td>{r.category ? <span className={`pill cat-${r.category}`}>{r.category}</span> : <span className="muted">—</span>}</td>
                    <td><span className={`pill ${r.status}`}>{r.status}</span></td>
                    <td className="muted"><div className="wrap">{r.detail}</div></td>
                    <td className="muted"><div className="wrap">{r.suggestedReply || ""}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Leads<span className="count">{leads.length}</span></h2>
        </div>
        {leads.length === 0 && <div className="empty">No emails captured yet. Turn on “Ask for an email address” in an automation.</div>}
        {leads.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>When</th><th>Instagram</th><th>Email</th><th>GoHighLevel</th></tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={`${l.igUserId}:${l.igsid}`}>
                    <td className="muted">{l.updatedAt ? new Date(l.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}</td>
                    <td>@{l.username}</td>
                    <td>{l.email}</td>
                    <td>{l.ghlContactId ? <span className="pill sent">synced</span> : <span className="pill skipped">not synced</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Accounts &amp; setup</h2>
        </div>
        {accounts.length === 0 && !env.accessToken && <div className="empty">No account yet. Click “Connect Instagram” in the top bar (needs a Business or Creator account).</div>}
        {accounts.length === 0 && env.accessToken && <p className="muted">Using the access token from the environment for account {env.igUserId || "(id not set)"}.</p>}
        {accounts.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Username</th><th>IG user id</th><th>Token expires</th><th>Posts</th></tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.igUserId}>
                    <td>@{a.username}</td>
                    <td><code>{a.igUserId}</code></td>
                    <td className="muted">{a.tokenExpiresAt ? new Date(a.tokenExpiresAt).toLocaleDateString() : "—"}</td>
                    <td><a href={`/media/${a.igUserId}`}>Pick a post</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <dl className="kv" style={{ marginTop: 14 }}>
          <dt>Webhook URL</dt><dd><code>{webhookUrl}</code></dd>
          <dt>Database</dt><dd>{hasSupabase() ? <span className="pill on">Supabase</span> : <span className="pill off">in-memory</span>}</dd>
          <dt>AI</dt><dd>{hasAi() ? <span className="pill on">Claude</span> : <span className="pill off">off</span>}</dd>
          <dt>CRM</dt><dd>{hasGhl() ? <span className="pill on">GoHighLevel</span> : <span className="pill off">off</span>}</dd>
        </dl>
      </section>
    </>
  );
}
