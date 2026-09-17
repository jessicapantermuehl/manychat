import type { DailyPoint } from "@/lib/analytics";

/**
 * Daily triggered vs delivered, as grouped bars. Inline SVG so it needs no client JS; each bar
 * carries a <title> so hovering shows the exact numbers.
 */
export function FunnelChart({ daily }: { daily: DailyPoint[] }) {
  const width = 960;
  const height = 200;
  const pad = { top: 12, right: 8, bottom: 28, left: 32 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...daily.map((d) => Math.max(d.triggered, d.delivered)));
  const groupW = innerW / Math.max(1, daily.length);
  const gap = 2;
  const barW = Math.max(2, (groupW - gap * 3) / 2);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const ticks = [0, Math.ceil(max / 2), max];
  const labelEvery = daily.length > 45 ? 14 : daily.length > 14 ? 7 : 1;

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily triggered and delivered">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.left - 6} y={y(t) + 4} textAnchor="end" className="tick">{t}</text>
          </g>
        ))}
        {daily.map((d, i) => {
          const x0 = pad.left + i * groupW + gap;
          const label = d.day.slice(5).replace("-", "/");
          return (
            <g key={d.day}>
              <rect x={x0} y={y(d.triggered)} width={barW} height={Math.max(0, pad.top + innerH - y(d.triggered))} rx={2} className="bar-triggered">
                <title>{`${d.day}: ${d.triggered} triggered`}</title>
              </rect>
              <rect x={x0 + barW + gap} y={y(d.delivered)} width={barW} height={Math.max(0, pad.top + innerH - y(d.delivered))} rx={2} className="bar-delivered">
                <title>{`${d.day}: ${d.delivered} delivered`}</title>
              </rect>
              {i % labelEvery === 0 && (
                <text x={x0 + barW + gap / 2} y={height - 8} textAnchor="middle" className="tick">{label}</text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="legend">
        <span><i className="swatch triggered" /> Triggered</span>
        <span><i className="swatch delivered" /> Delivered</span>
      </figcaption>
    </figure>
  );
}
