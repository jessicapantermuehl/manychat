import { defaultClientFor } from "@/lib/runner";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Lists recent posts so you can copy a media id (or jump straight to creating a rule for it). */
export default async function MediaPage({ params }: { params: Promise<{ igUserId: string }> }) {
  const { igUserId } = await params;
  const client = await defaultClientFor(getStore(), igUserId);

  let items: Array<{ id: string; caption?: string; media_type: string; permalink: string; timestamp: string }> = [];
  let error: string | null = null;
  if (!client) error = "No access token for this account.";
  else {
    try {
      items = (await client.listMedia(igUserId, 30)).data;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  return (
    <>
      <header className="top">
        <div><h1>Pick a post</h1><div className="sub">Scope an automation to one post or Reel.</div></div>
        <a className="btn secondary" href="/">Cancel</a>
      </header>
      <section className="card">
        {error && <div className="notice bad">{error}</div>}
        {!error && items.length === 0 && <div className="empty">No posts found.</div>}
        {items.length > 0 && (
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Caption</th><th>Media ID</th><th></th></tr></thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id}>
                  <td className="muted">{new Date(m.timestamp).toLocaleDateString()}</td>
                  <td>{m.media_type}</td>
                  <td><a href={m.permalink} target="_blank" rel="noreferrer">{(m.caption ?? "").slice(0, 80) || "(no caption)"}</a></td>
                  <td><code>{m.id}</code></td>
                  <td><a className="btn sm" href={`/automations/new?igUserId=${igUserId}&mediaId=${m.id}`}>Automate</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
