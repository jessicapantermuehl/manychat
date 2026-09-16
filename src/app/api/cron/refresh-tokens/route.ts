import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { refreshLongLivedToken } from "@/lib/instagram";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Long-lived Instagram tokens last 60 days. Vercel cron hits this weekly (see vercel.json)
 * and refreshes any token that expires within the next 14 days.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (env.cronSecret && auth !== `Bearer ${env.cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const store = getStore();
  const accounts = await store.listAccounts();
  const soon = Date.now() + 14 * 24 * 60 * 60 * 1000;
  const refreshed: string[] = [];
  const failed: Array<{ igUserId: string; error: string }> = [];

  for (const account of accounts) {
    const expires = account.tokenExpiresAt ? Date.parse(account.tokenExpiresAt) : 0;
    if (expires > soon) continue;
    try {
      const next = await refreshLongLivedToken(account.accessToken);
      await store.upsertAccount({
        ...account,
        accessToken: next.access_token,
        tokenExpiresAt: new Date(Date.now() + next.expires_in * 1000).toISOString(),
      });
      refreshed.push(account.igUserId);
    } catch (err) {
      failed.push({ igUserId: account.igUserId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ refreshed, failed });
}
