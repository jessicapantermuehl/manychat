import { FunnelChart } from "@/components/FunnelChart";
import { computeFunnel, rate } from "@/lib/analytics";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const RANGES = [7, 30, 90] as const;

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const days = RANGES.includes(Number(params.days) as (typeof RANGES)[number]) ? Number(params.days) : 7;
  const store = getStore();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [activity, automations] = await Promise.all([store.listActivitySince(since), store.listAutomations()]);
  const funnel = computeFunnel(activity, automations, days);
  const t = funnel.totals;
  const cats = Object.entries(funnel.categories).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <header className="top">
        <div>
          <h1>Analytics</h1>
          <div className="sub">How each automation converts, from trigger to delivery.</div>
        </div>
        <div className="actions">
          {RANGES.map((r) => (
            <a key={r} className={`btn ${r === days ? "" : "secondary"} sm`} href={`/analytics?days=${r}`}>{r} days</a>
          ))}
        </div>
      </header>

      <section className="stats" aria-label={`Last ${days} days`}>
        <div className="stat">
          <div className="label">Triggered</div>
          <div className="value">{t.triggered}</div>
          <div className="delta">Someone asked for something and the app replied.</div>
        </div>
        <div className="stat">
          <div className="label">Opted in</div>
          <div className="value">{t.optedIn}</div>
          <div className="delta">{rate(t.optedIn, t.triggered)} of triggered. They tapped the Yes button.</div>
        </div>
        <div className="stat">
          <div className="label">Delivered</div>
          <div className="value">{t.delivered}</div>
          <div className="delta">{rate(t.delivered, t.triggered)} of triggered. The link (or email confirmation) was sent.</div>
        </div>
        <div className="stat">
          <div className="label">Emails captured</div>
          <div className="value">{t.emails}</div>
          <div className="delta">{rate(t.emails, t.delivered)} of delivered. Address given in the DM, not on a landing page.</div>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Per day</h2></div>
        <FunnelChart daily={funnel.daily} />
      </section>

      <section className="card">
        <div className="card-head"><h2>By automation</h2></div>
        {funnel.rows.length === 0 && <div className="empty">Nothing triggered in this period.</div>}
        {funnel.rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Automation</th><th className="num">Triggered</th><th className="num">Opted in</th><th className="num">Delivered</th><th className="num">Delivery rate</th><th className="num">Emails</th><th className="num">Failed</th></tr>
              </thead>
              <tbody>
                {funnel.rows.map((r) => (
                  <tr key={r.automationId ?? r.name}>
                    <td>{r.automationId ? <a href={`/automations/${r.automationId}`}>{r.name}</a> : r.name}</td>
                    <td className="num">{r.triggered}</td>
                    <td className="num">{r.optedIn}</td>
                    <td className="num">{r.delivered}</td>
                    <td className="num">{rate(r.delivered, r.triggered)}</td>
                    <td className="num">{r.emails}</td>
                    <td className="num">{r.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="row">
        <section className="card">
          <div className="card-head"><h2>Comment types</h2></div>
          {cats.length === 0 && <div className="empty">No AI labels yet.</div>}
          {cats.length > 0 && (
            <dl className="kv">
              {cats.map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <dt><span className={`pill cat-${k}`}>{k}</span></dt>
                  <dd className="num">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
        <section className="card">
          <div className="card-head"><h2>Missed and failed</h2></div>
          <dl className="kv">
            <dt>Comments that matched nothing</dt><dd>{t.unmatched}</dd>
            <dt>Failures</dt><dd>{t.failed}</dd>
          </dl>
          <p className="muted" style={{ marginTop: 10 }}>
            A high “matched nothing” number usually means people are asking in their own words. Add an intent description to the automation to catch them.
          </p>
        </section>
      </div>
    </>
  );
}
