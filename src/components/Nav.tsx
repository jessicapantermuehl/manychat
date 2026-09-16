export function Nav() {
  return (
    <nav className="nav">
      <div className="nav-inner">
        <a className="brand" href="/">
          <span className="brand-mark">C</span>
          ConvertlySocial
        </a>
        <div className="nav-links">
          <a href="/">Dashboard</a>
          <a href="/automations/new">New automation</a>
          <a href="/settings">Voice &amp; AI</a>
        </div>
        <div className="nav-spacer" />
        <a className="btn secondary sm" href="/api/instagram/connect">Connect Instagram</a>
      </div>
    </nav>
  );
}
