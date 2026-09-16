import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { exchangeCodeForToken, exchangeForLongLivedToken, InstagramClient } from "@/lib/instagram";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Instagram redirects here after the user approves the app. Stores a 60-day token. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  const origin = env.appUrl || url.origin;

  if (error) return NextResponse.redirect(`${origin}/?error=${encodeURIComponent(error)}`);
  if (!code) return NextResponse.redirect(`${origin}/?error=missing_code`);

  const cookieStore = await cookies();
  const expected = cookieStore.get("ig_oauth_state")?.value;
  if (!expected || expected !== state) return NextResponse.redirect(`${origin}/?error=bad_state`);

  try {
    const redirectUri = `${origin}/api/instagram/callback`;
    const short = await exchangeCodeForToken({ appId: env.appId, appSecret: env.appSecret, redirectUri, code });
    const long = await exchangeForLongLivedToken({ appSecret: env.appSecret, shortLivedToken: short.access_token });

    const client = new InstagramClient(long.access_token, { apiVersion: env.apiVersion });
    const me = await client.me();
    const igUserId = String(me.user_id ?? me.id ?? short.user_id);

    // Ask Meta to send this account's comment + message webhooks to our app.
    await client.subscribeToWebhooks(igUserId).catch((e) => console.error("subscribe failed", e));

    await getStore().upsertAccount({
      igUserId,
      username: me.username,
      accessToken: long.access_token,
      tokenExpiresAt: new Date(Date.now() + long.expires_in * 1000).toISOString(),
    });

    const res = NextResponse.redirect(`${origin}/?connected=${encodeURIComponent(me.username)}`);
    res.cookies.delete("ig_oauth_state");
    return res;
  } catch (err) {
    console.error("Instagram connect failed", err);
    const message = err instanceof Error ? err.message : "connect_failed";
    return NextResponse.redirect(`${origin}/?error=${encodeURIComponent(message)}`);
  }
}
