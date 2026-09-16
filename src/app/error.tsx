"use client";

/** Last-resort error screen. Shows the real message instead of Next.js's blank "client-side exception" page. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="card">
      <h2>Something went wrong</h2>
      <p className="muted" style={{ marginTop: 8 }}>{error.message || "Unknown error"}</p>
      {error.digest && <p className="muted">Reference: <code>{error.digest}</code></p>}
      <div className="actions" style={{ marginTop: 14 }}>
        <button className="btn" onClick={() => reset()}>Try again</button>
        <a className="btn secondary" href="/">Back to dashboard</a>
      </div>
    </section>
  );
}
