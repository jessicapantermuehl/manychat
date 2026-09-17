import type { ActivityRecord, Automation } from "./types";

/**
 * Funnel metrics derived from the activity log. The log's detail strings are written by the
 * runner, so matching on them is stable; each row is classified into the stages it represents.
 */
export interface FunnelRow {
  automationId: string | null;
  name: string;
  /** A comment, story reply, story mention or DM that matched and started a flow. */
  triggered: number;
  /** Yes taps on the opt-in question. */
  optedIn: number;
  /** Times the link (or the email-only confirmation) went out. */
  delivered: number;
  /** Emails captured in the DM. */
  emails: number;
  /** Comments that matched nothing (only meaningful on the totals row). */
  unmatched: number;
  failed: number;
}

export interface DailyPoint {
  /** YYYY-MM-DD */
  day: string;
  triggered: number;
  delivered: number;
}

export interface Funnel {
  rows: FunnelRow[];
  totals: FunnelRow;
  daily: DailyPoint[];
  categories: Record<string, number>;
  days: number;
}

export function stagesOf(r: ActivityRecord): { triggered: boolean; optedIn: boolean; delivered: boolean; email: boolean } {
  const d = r.detail ?? "";
  const ok = r.status === "sent" || r.status === "captured";
  // A first-contact row: the comment/story/DM matched and the app tried to respond (even if the DM failed).
  const firstContact = !d.startsWith("opted in") && !d.startsWith("now following") && !d.startsWith("changed their mind");
  const triggered =
    r.status !== "skipped" &&
    firstContact &&
    (d.includes("asked for opt-in") || d.includes(" trigger") || /(^|; )DM sent/.test(d) || /(^|; )asked for email$/.test(d) || /(^|; )DM failed/.test(d));
  const optedIn = ok && d.startsWith("opted in");
  const delivered = ok && (d.includes("link sent") || d.includes("delivery by email"));
  const email = r.status === "captured";
  return { triggered, optedIn, delivered, email };
}

function emptyRow(automationId: string | null, name: string): FunnelRow {
  return { automationId, name, triggered: 0, optedIn: 0, delivered: 0, emails: 0, unmatched: 0, failed: 0 };
}

function dayOf(iso: string | undefined): string {
  return (iso ?? new Date().toISOString()).slice(0, 10);
}

export function computeFunnel(activity: ActivityRecord[], automations: Automation[], days: number, now = new Date()): Funnel {
  const names = new Map(automations.map((a) => [a.id, a.name]));
  const rows = new Map<string, FunnelRow>();
  const totals = emptyRow(null, "All automations");
  const categories: Record<string, number> = {};

  // Pre-fill the daily series so quiet days show as zero.
  const daily = new Map<string, DailyPoint>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    daily.set(d, { day: d, triggered: 0, delivered: 0 });
  }

  for (const r of activity) {
    if (r.category) categories[r.category] = (categories[r.category] ?? 0) + 1;
    if (r.status === "skipped" && r.detail === "no matching automation") totals.unmatched += 1;
    if (r.status === "failed") totals.failed += 1;

    if (!r.automationId) continue;
    const row = rows.get(r.automationId) ?? emptyRow(r.automationId, names.get(r.automationId) ?? "Deleted automation");
    const s = stagesOf(r);
    if (s.triggered) row.triggered += 1;
    if (s.optedIn) row.optedIn += 1;
    if (s.delivered) row.delivered += 1;
    if (s.email) row.emails += 1;
    if (r.status === "failed") row.failed += 1;
    rows.set(r.automationId, row);

    const point = daily.get(dayOf(r.createdAt));
    if (point) {
      if (s.triggered) point.triggered += 1;
      if (s.delivered) point.delivered += 1;
    }
  }

  for (const row of rows.values()) {
    totals.triggered += row.triggered;
    totals.optedIn += row.optedIn;
    totals.delivered += row.delivered;
    totals.emails += row.emails;
  }

  const ordered = [...rows.values()].sort((a, b) => b.triggered - a.triggered);
  return { rows: ordered, totals, daily: [...daily.values()], categories, days };
}

export function rate(part: number, whole: number): string {
  if (!whole) return "–";
  return `${Math.round((part / whole) * 100)}%`;
}
